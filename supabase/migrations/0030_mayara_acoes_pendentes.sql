-- supabase/migrations/0030_mayara_acoes_pendentes.sql
insert into mayara.config (chave, valor) values ('central_linguagem_livre', 'false') on conflict (chave) do nothing;

create table mayara.acoes_pendentes (
  id bigserial primary key,
  acao text not null check (acao in ('pausar', 'ligar', 'assumir', 'devolver', 'desfazer_regra', 'reativar_regra', 'abordar')),
  argumentos jsonb not null default '{}'::jsonb,
  resumo text not null,
  autor_chave text not null default '',
  estado text not null default 'pendente' check (estado in ('pendente', 'confirmada', 'cancelada', 'expirada')),
  criado_em timestamptz not null default now(),
  confirmar_ate timestamptz not null default (now() + interval '10 minutes'),
  encerrada_em timestamptz
);
create unique index acoes_pendentes_uma_pendente on mayara.acoes_pendentes ((true)) where estado = 'pendente';
alter table mayara.acoes_pendentes enable row level security;
revoke all on mayara.acoes_pendentes from anon, authenticated;

create or replace function mayara.expirar_acoes_pendentes()
returns integer language plpgsql set search_path = '' as $$
declare v int;
begin
  update mayara.acoes_pendentes set estado = 'expirada', encerrada_em = now()
  where estado = 'pendente' and confirmar_ate < now();
  get diagnostics v = row_count;
  return v;
end $$;

create or replace function mayara.criar_acao_pendente(p_acao text, p_argumentos jsonb, p_resumo text, p_autor text)
returns text language plpgsql set search_path = '' as $$
declare
  v_pend text;
  v_args jsonb := coalesce(p_argumentos, '{}'::jsonb);
begin
  perform mayara.expirar_pendentes();
  perform mayara.expirar_acoes_pendentes();
  if p_acao not in ('pausar', 'ligar', 'assumir', 'devolver', 'desfazer_regra', 'reativar_regra', 'abordar') then
    return 'Ação não reconhecida. Nada foi alterado.';
  end if;
  if p_acao = 'abordar' then
    return 'Essa ação ainda não está habilitada.';
  end if;
  if p_acao in ('assumir', 'devolver') and mayara.chave_telefone(v_args ->> 'telefone') is null then
    return 'Número inválido. Use o formato +5514999990000 (com DDD).';
  end if;
  if p_acao in ('desfazer_regra', 'reativar_regra') and coalesce(v_args ->> 'numero', '') !~ '^[0-9]{1,9}$' then
    return 'Número da regra inválido. Veja os números em /regras.';
  end if;
  select resumo into v_pend from mayara.acoes_pendentes where estado = 'pendente';
  if v_pend is not null then
    return 'Ainda há uma ação aguardando confirmação: ' || v_pend || E'\nResponda *sim* ou *não* antes de pedir outra.';
  end if;
  select texto into v_pend from mayara.instrucoes where estado = 'pendente';
  if v_pend is not null then
    return 'Ainda há uma instrução aguardando confirmação: ' || v_pend || E'\nResponda *sim* ou *não* antes de pedir outra.';
  end if;
  insert into mayara.acoes_pendentes (acao, argumentos, resumo, autor_chave)
  values (p_acao, v_args, left(btrim(coalesce(p_resumo, '')), 300), coalesce(mayara.chave_telefone(p_autor), p_autor, ''));
  return left(btrim(coalesce(p_resumo, '')), 300) || E'\nConfirma? Responda *sim* ou *não* (vale por 10 minutos).';
exception when unique_violation then
  return 'Ainda há uma ação aguardando confirmação. Responda *sim* ou *não* antes de pedir outra.';
end $$;

create or replace function mayara.confirmar_acao_pendente(p_decisao text)
returns text language plpgsql set search_path = '' as $$
declare v mayara.acoes_pendentes%rowtype; r text;
begin
  perform mayara.expirar_acoes_pendentes();
  select * into v from mayara.acoes_pendentes where estado = 'pendente' for update;
  if not found then
    if not exists (select 1 from mayara.instrucoes where estado = 'pendente')
       and exists (select 1 from mayara.acoes_pendentes where estado = 'expirada' and encerrada_em > now() - interval '60 minutes') then
      return 'A ação expirou (passaram mais de 10 minutos). Peça de novo.';
    end if;
    return null;
  end if;
  if p_decisao <> 'sim' then
    update mayara.acoes_pendentes set estado = 'cancelada', encerrada_em = now() where id = v.id;
    return 'Ok, cancelei: ' || v.resumo;
  end if;
  update mayara.acoes_pendentes set estado = 'confirmada', encerrada_em = now() where id = v.id;
  r := case v.acao
    when 'assumir' then mayara.assumir_lead(v.argumentos ->> 'telefone')
    when 'devolver' then mayara.devolver_lead(v.argumentos ->> 'telefone')
    when 'desfazer_regra' then mayara.desfazer_instrucao((v.argumentos ->> 'numero')::bigint)
    when 'reativar_regra' then mayara.reativar_instrucao((v.argumentos ->> 'numero')::bigint)
    when 'pausar' then '@efeito {"tipo":"modo","aiMode":"paused"}' || E'\nPausando a Mayara para todos os leads.'
    when 'ligar' then '@efeito {"tipo":"modo","aiMode":"active"}' || E'\nLigando a Mayara.'
    else 'Ação não reconhecida. Nada foi alterado.'
  end;
  return r;
end $$;

create or replace function mayara.confirmar_pendente(p_decisao text)
returns text language plpgsql set search_path = '' as $$
declare v mayara.instrucoes%rowtype; r text;
begin
  r := mayara.confirmar_acao_pendente(p_decisao);
  if r is not null then
    return r;
  end if;
  perform mayara.expirar_pendentes();
  select * into v from mayara.instrucoes where estado = 'pendente';
  if not found then
    if exists (select 1 from mayara.instrucoes
               where estado = 'expirada' and encerrada_em > now() - interval '60 minutes') then
      return 'A instrução expirou (passaram mais de 30 minutos). Envie de novo.';
    end if;
    return 'Não há nenhuma instrução aguardando confirmação.';
  end if;
  if p_decisao = 'sim' then
    if (select count(*) from mayara.instrucoes where estado = 'ativa') >= mayara._max_ativas() then
      return 'Não consegui ativar: o limite de ' || mayara._max_ativas()::text
             || ' instruções ativas foi atingido. Use /desfazer.';
    end if;
    update mayara.instrucoes set estado = 'ativa', ativada_em = now() where id = v.id;
    return 'Pronto, vale a partir da próxima mensagem de lead:' || E'\n' || v.id::text || '. ' || v.texto;
  end if;
  update mayara.instrucoes set estado = 'recusada', encerrada_em = now() where id = v.id;
  return 'Ok, descartei essa instrução.';
end $$;

create or replace function mayara.criar_pendente(p_texto text, p_original text, p_autor text)
returns text language plpgsql set search_path = '' as $$
declare
  v_texto text := btrim(coalesce(p_texto, ''));
  v_pend text;
begin
  perform mayara.expirar_pendentes();
  perform mayara.expirar_acoes_pendentes();
  if v_texto = '' then
    return 'Não consegui entender a instrução. Pode escrever de outro jeito?';
  end if;
  if char_length(v_texto) > 400 then
    return 'A instrução ficou longa demais (máximo 400 caracteres). Resuma ou divida em duas.';
  end if;
  select resumo into v_pend from mayara.acoes_pendentes where estado = 'pendente';
  if v_pend is not null then
    return 'Ainda há uma ação aguardando confirmação: ' || v_pend || E'\nResponda *sim* ou *não* antes de enviar outra.';
  end if;
  select texto into v_pend from mayara.instrucoes where estado = 'pendente';
  if v_pend is not null then
    return 'Ainda há uma instrução aguardando confirmação: ' || v_pend
           || E'\nResponda *sim* ou *não* antes de enviar outra.';
  end if;
  if (select count(*) from mayara.instrucoes where estado = 'ativa') >= mayara._max_ativas() then
    return 'Já há ' || mayara._max_ativas()::text || ' instruções ativas. Use /regras e /desfazer para abrir espaço.';
  end if;
  insert into mayara.instrucoes (texto, texto_original, autor_chave)
  values (v_texto, p_original, coalesce(mayara.chave_telefone(p_autor), p_autor, ''));
  return 'Entendi: ' || v_texto || E'\nConfirma? Responda *sim* ou *não* (vale por 30 minutos).';
exception when unique_violation then
  return 'Ainda há uma instrução aguardando confirmação. Responda *sim* ou *não* antes de enviar outra.';
end $$;

revoke all on function mayara.expirar_acoes_pendentes() from public, anon, authenticated;
revoke all on function mayara.criar_acao_pendente(text, jsonb, text, text) from public, anon, authenticated;
revoke all on function mayara.confirmar_acao_pendente(text) from public, anon, authenticated;
revoke all on function mayara.confirmar_pendente(text) from public, anon, authenticated;
revoke all on function mayara.criar_pendente(text, text, text) from public, anon, authenticated;
