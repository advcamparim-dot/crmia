-- supabase/migrations/0011_mayara_central_comando.sql
-- Central de comando da Mayara: administradores, livro de instrucoes, auditoria e funcoes.

create table mayara.administradores (
  telefone text primary key check (telefone ~ '^\+55[0-9]{10,11}$'),
  telefone_chave text generated always as (mayara.chave_telefone(telefone)) stored not null,
  nome text,
  ativo boolean not null default true,
  criado_em timestamptz not null default now()
);
create unique index administradores_chave_uq on mayara.administradores (telefone_chave);

create table mayara.instrucoes (
  id bigserial primary key,
  texto text not null check (char_length(texto) <= 400),
  texto_original text,
  estado text not null default 'pendente'
    check (estado in ('pendente', 'ativa', 'recusada', 'expirada', 'desfeita')),
  autor_chave text not null,
  criado_em timestamptz not null default now(),
  confirmar_ate timestamptz not null default now() + interval '30 minutes',
  ativada_em timestamptz,
  encerrada_em timestamptz
);
create unique index instrucoes_uma_pendente on mayara.instrucoes ((true)) where estado = 'pendente';
create index instrucoes_estado_idx on mayara.instrucoes (estado, ativada_em desc);

create table mayara.comandos_log (
  id bigserial primary key,
  message_id text unique,
  admin_chave text not null,
  entrada text not null,
  acao text,
  resultado text,
  criado_em timestamptz not null default now()
);

alter table mayara.administradores enable row level security;
alter table mayara.instrucoes enable row level security;
alter table mayara.comandos_log enable row level security;
revoke all on mayara.administradores, mayara.instrucoes, mayara.comandos_log from anon, authenticated;
revoke all on sequence mayara.instrucoes_id_seq, mayara.comandos_log_id_seq from anon, authenticated;

insert into mayara.config (chave, valor) values
  ('canal_comando_exclusivo', 'false'),
  ('instrucoes_max_ativas', '30')
on conflict (chave) do nothing;

create or replace function mayara._max_ativas()
returns int language sql stable set search_path = '' as $$
  select coalesce((select valor::int from mayara.config where chave = 'instrucoes_max_ativas'), 30)
$$;

create or replace function mayara.eh_administrador(p_telefone text)
returns boolean language sql stable set search_path = '' as $$
  select exists (
    select 1 from mayara.administradores a
    where a.ativo and a.telefone_chave = mayara.chave_telefone(p_telefone)
  )
$$;

create or replace function mayara.rota_mensagem(p_telefone text, p_texto text)
returns text language sql stable set search_path = '' as $$
  select case
    when mayara.eh_administrador(p_telefone)
     and (coalesce((select valor from mayara.config where chave = 'canal_comando_exclusivo'), 'false') = 'true'
          or left(ltrim(coalesce(p_texto, '')), 1) = '/')
    then 'comando' else 'lead' end
$$;

create or replace function mayara.instrucoes_ativas_texto()
returns text language sql stable set search_path = '' as $$
  select coalesce(string_agg(n::text || '. ' || t, E'\n' order by n), '')
  from (
    select row_number() over (order by ativada_em desc, id desc) as n,
           replace(replace(texto, '{{', ''), '}}', '') as t
    from mayara.instrucoes
    where estado = 'ativa'
  ) x
$$;

create or replace function mayara.expirar_pendentes()
returns int language plpgsql set search_path = '' as $$
declare v int;
begin
  update mayara.instrucoes set estado = 'expirada', encerrada_em = now()
  where estado = 'pendente' and confirmar_ate < now();
  get diagnostics v = row_count;
  return v;
end $$;

create or replace function mayara.registrar_comando(p_message_id text, p_telefone text, p_entrada text)
returns boolean language plpgsql set search_path = '' as $$
declare v int;
begin
  insert into mayara.comandos_log (message_id, admin_chave, entrada)
  values (p_message_id, coalesce(mayara.chave_telefone(p_telefone), ''), coalesce(p_entrada, ''))
  on conflict (message_id) do nothing;
  get diagnostics v = row_count;
  return v = 1;
end $$;

create or replace function mayara.finalizar_comando(p_message_id text, p_acao text, p_resultado text)
returns text language plpgsql set search_path = '' as $$
begin
  update mayara.comandos_log
     set acao = p_acao, resultado = left(coalesce(p_resultado, ''), 500)
   where message_id = p_message_id;
  return coalesce(p_resultado, 'Pronto.');
end $$;

create or replace function mayara.contexto_central(p_telefone text)
returns jsonb language plpgsql set search_path = '' as $$
begin
  perform mayara.expirar_pendentes();
  return jsonb_build_object(
    'pendente', exists (select 1 from mayara.instrucoes where estado = 'pendente'),
    'exclusivo', coalesce((select valor from mayara.config where chave = 'canal_comando_exclusivo'), 'false') = 'true'
  );
end $$;

create or replace function mayara.criar_pendente(p_texto text, p_original text, p_autor text)
returns text language plpgsql set search_path = '' as $$
declare
  v_texto text := btrim(coalesce(p_texto, ''));
  v_pend text;
begin
  perform mayara.expirar_pendentes();
  if v_texto = '' then
    return 'Não consegui entender a instrução. Pode escrever de outro jeito?';
  end if;
  if char_length(v_texto) > 400 then
    return 'A instrução ficou longa demais (máximo 400 caracteres). Resuma ou divida em duas.';
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

create or replace function mayara.confirmar_pendente(p_decisao text)
returns text language plpgsql set search_path = '' as $$
declare v mayara.instrucoes%rowtype;
begin
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

create or replace function mayara.desfazer_instrucao(p_id bigint)
returns text language plpgsql set search_path = '' as $$
declare v mayara.instrucoes%rowtype;
begin
  select * into v from mayara.instrucoes where id = p_id;
  if not found then
    return 'Não achei a instrução ' || p_id::text || '. Veja /regras.';
  end if;
  if v.estado <> 'ativa' then
    return 'A instrução ' || p_id::text || ' não está ativa (estado: ' || v.estado || ').';
  end if;
  update mayara.instrucoes set estado = 'desfeita', encerrada_em = now() where id = p_id;
  return 'Desfeita: ' || v.texto || E'\nPara restaurar: /reativar ' || p_id::text;
end $$;

create or replace function mayara.reativar_instrucao(p_id bigint)
returns text language plpgsql set search_path = '' as $$
declare v mayara.instrucoes%rowtype;
begin
  select * into v from mayara.instrucoes where id = p_id;
  if not found then
    return 'Não achei a instrução ' || p_id::text || '. Veja /regras.';
  end if;
  if v.estado <> 'desfeita' then
    return 'Só dá para reativar instrução desfeita (a ' || p_id::text || ' está ' || v.estado || ').';
  end if;
  if (select count(*) from mayara.instrucoes where estado = 'ativa') >= mayara._max_ativas() then
    return 'Limite de ' || mayara._max_ativas()::text || ' instruções ativas atingido. Use /desfazer antes.';
  end if;
  update mayara.instrucoes set estado = 'ativa', ativada_em = now(), encerrada_em = null where id = p_id;
  return 'Reativada: ' || v.texto;
end $$;

create or replace function mayara.regras_texto()
returns text language sql stable set search_path = '' as $$
  select case when count(*) = 0 then 'Nenhuma instrução ativa.'
              else 'Instruções ativas:' || E'\n'
                   || string_agg(id::text || '. ' || texto, E'\n' order by ativada_em desc, id desc)
         end
  from mayara.instrucoes where estado = 'ativa'
$$;

create or replace function mayara.assumir_lead(p_telefone text)
returns text language plpgsql set search_path = '' as $$
declare v_chave text := mayara.chave_telefone(p_telefone); v_status text;
begin
  if v_chave is null then
    return 'Número inválido. Use o formato +5514999990000 (com DDD).';
  end if;
  select status into v_status from mayara.leads_autorizados where telefone_chave = v_chave;
  if v_status is null then
    return 'Esse número não está na lista de leads da Mayara.';
  end if;
  if v_status = 'bloqueado' then
    return 'A Mayara já estava fora desse atendimento.';
  end if;
  if v_status = 'sem_interesse' then
    return 'Esse lead marcou sem interesse, e a Mayara já não responde a ele.';
  end if;
  update mayara.leads_autorizados set status = 'bloqueado' where telefone_chave = v_chave;
  update mayara.session_state set estado = 'S7_HANDOFF_HUMANO'
   where mayara.chave_telefone(phone) = v_chave;
  return 'Pronto. A Mayara parou de responder a ' || p_telefone || '. Para devolver: /devolver ' || p_telefone;
end $$;

create or replace function mayara.devolver_lead(p_telefone text)
returns text language plpgsql set search_path = '' as $$
declare v_chave text := mayara.chave_telefone(p_telefone); v_status text;
begin
  if v_chave is null then
    return 'Número inválido. Use o formato +5514999990000 (com DDD).';
  end if;
  select status into v_status from mayara.leads_autorizados where telefone_chave = v_chave;
  if v_status is null then
    return 'Esse número não está na lista de leads da Mayara.';
  end if;
  if v_status <> 'bloqueado' then
    return 'Esse lead não estava com atendimento humano (estado: ' || v_status || ').';
  end if;
  update mayara.leads_autorizados set status = 'ativo' where telefone_chave = v_chave;
  update mayara.session_state set estado = 'S2_QUALIFICACAO'
   where mayara.chave_telefone(phone) = v_chave and estado = 'S7_HANDOFF_HUMANO';
  return 'Pronto. A Mayara voltou a atender ' || p_telefone || '.';
end $$;

create or replace function mayara.status_resumo()
returns text language sql stable set search_path = '' as $$
  select 'Conversas nas últimas 24 h: '
         || (select count(*) from mayara.session_state where last_lead_message_at > now() - interval '24 hours')::text
         || E'\nConsultas hoje: '
         || (select count(*) from mayara.session_state
              where consulta_agendada_em is not null
                and (consulta_agendada_em at time zone 'America/Sao_Paulo')::date
                  = (now() at time zone 'America/Sao_Paulo')::date)::text
         || E'\nConsultas nos próximos 7 dias: '
         || (select count(*) from mayara.session_state
              where consulta_agendada_em between now() and now() + interval '7 days')::text
         || E'\nInstruções ativas: '
         || (select count(*) from mayara.instrucoes where estado = 'ativa')::text
         || E'\nLeads com atendimento humano: '
         || (select count(*) from mayara.leads_autorizados where status = 'bloqueado')::text
$$;

create or replace function mayara.executar_central(p_fn text, p_arg text, p_arg2 text, p_autor text)
returns text language plpgsql set search_path = '' as $$
begin
  return case p_fn
    when 'status' then mayara.status_resumo()
    when 'regras' then mayara.regras_texto()
    when 'assumir' then mayara.assumir_lead(p_arg)
    when 'devolver' then mayara.devolver_lead(p_arg)
    when 'desfazer' then case when p_arg ~ '^[0-9]{1,9}$'
                              then mayara.desfazer_instrucao(p_arg::bigint)
                              else 'Use /desfazer <número>. Veja os números em /regras.' end
    when 'reativar' then case when p_arg ~ '^[0-9]{1,9}$'
                              then mayara.reativar_instrucao(p_arg::bigint)
                              else 'Use /reativar <número>.' end
    when 'confirmar_sim' then mayara.confirmar_pendente('sim')
    when 'confirmar_nao' then mayara.confirmar_pendente('nao')
    when 'criar_pendente' then mayara.criar_pendente(p_arg, p_arg2, p_autor)
    else 'Comando não reconhecido. Envie /ajuda.'
  end;
end $$;

do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'mayara'
      and p.proname in ('_max_ativas', 'eh_administrador', 'rota_mensagem', 'instrucoes_ativas_texto',
        'expirar_pendentes', 'registrar_comando', 'finalizar_comando', 'contexto_central', 'criar_pendente',
        'confirmar_pendente', 'desfazer_instrucao', 'reativar_instrucao', 'regras_texto', 'assumir_lead',
        'devolver_lead', 'status_resumo', 'executar_central')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
  end loop;
end $$;
