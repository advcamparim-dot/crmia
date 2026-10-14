-- supabase/migrations/0049_mayara_blindagem_canal.sql
insert into mayara.config (chave, valor) values ('canal_vigia', 'false') on conflict (chave) do nothing;
insert into mayara.config (chave, valor) values ('alerta_email_destino', '') on conflict (chave) do nothing;

create table if not exists mayara.mensagens_canal_vistas (
  canal_id text not null,
  message_id text not null,
  direcao text not null check (direcao in ('entrada', 'saida_humana', 'saida_mayara')),
  origem text not null check (origem in ('webhook', 'recuperacao')),
  visto_em timestamptz not null default now(),
  primary key (canal_id, message_id)
);
alter table mayara.mensagens_canal_vistas enable row level security;
revoke all on mayara.mensagens_canal_vistas from anon, authenticated;
create index if not exists mensagens_canal_vistas_visto_idx on mayara.mensagens_canal_vistas (visto_em);

alter table mayara.canal_estado
  add column if not exists queda_desde timestamptz,
  add column if not exists tentativas_restart int not null default 0,
  add column if not exists ultimo_restart_em timestamptz,
  add column if not exists lembretes_enviados int not null default 0,
  add column if not exists ultimo_lembrete_em timestamptz,
  add column if not exists sincronizado_ate timestamptz,
  add column if not exists ultima_recuperacao_em timestamptz;

-- Cursor inicial: a recuperacao nunca olha antes da implantacao.
update mayara.canal_estado
   set sincronizado_ate = coalesce(sincronizado_ate, now()), ultima_recuperacao_em = coalesce(ultima_recuperacao_em, now())
 where canal_id = 'escritorio';

create or replace function mayara.marcar_mensagem_vista(p_canal text, p_message_id text, p_direcao text, p_origem text)
returns boolean language plpgsql set search_path = '' as $$
declare v int;
begin
  if coalesce(btrim(p_message_id), '') = '' then
    return true;
  end if;
  insert into mayara.mensagens_canal_vistas (canal_id, message_id, direcao, origem)
  values (p_canal, p_message_id, p_direcao, p_origem)
  on conflict (canal_id, message_id) do nothing;
  get diagnostics v = row_count;
  return v > 0;
end $$;

create or replace function mayara.mensagem_ja_vista(p_canal text, p_message_id text)
returns boolean language sql stable set search_path = '' as $$
  select exists (select 1 from mayara.mensagens_canal_vistas where canal_id = p_canal and message_id = p_message_id)
$$;

create or replace function mayara.registrar_mensagem_humana(p_telefone text, p_texto text, p_quando timestamptz)
returns boolean language plpgsql set search_path = '' as $$
declare v_chave text := mayara.chave_telefone(p_telefone); v_sid text; v_texto text := btrim(coalesce(p_texto, ''));
begin
  if v_chave is null or v_texto = '' then
    return false;
  end if;
  select h.session_id into v_sid from public.n8n_chat_histories h
   where mayara.chave_telefone(substring(h.session_id from '[+0-9]+$')) = v_chave
   order by h.created_at desc limit 1;
  if v_sid is null then
    select s.session_key into v_sid from mayara.session_state s
     where mayara.chave_telefone(s.phone) = v_chave order by s.updated_at desc limit 1;
  end if;
  if v_sid is null then
    select 'whatsapp:escritorio:' || la.telefone into v_sid from mayara.leads_autorizados la where la.telefone_chave = v_chave;
  end if;
  if v_sid is null then
    return false;
  end if;
  insert into public.n8n_chat_histories (session_id, message, created_at)
  values (v_sid, jsonb_build_object('type', 'ai',
            'content', 'Mensagem enviada por uma pessoa do escritório: ' || left(v_texto, 1500),
            'tool_calls', '[]'::jsonb, 'additional_kwargs', '{}'::jsonb,
            'response_metadata', '{}'::jsonb, 'invalid_tool_calls', '[]'::jsonb),
          least(coalesce(p_quando, now()), now()));
  return true;
end $$;

create or replace function mayara.tratar_mensagem_humana(p_canal text, p_telefone text, p_message_id text, p_texto text, p_quando timestamptz)
returns jsonb language plpgsql set search_path = '' as $$
declare r jsonb; v_mem boolean := false;
begin
  r := mayara.humano_assumiu(p_canal, p_telefone, p_message_id);
  if (r ->> 'acao') in ('assumido', 'ignorado') then
    v_mem := mayara.registrar_mensagem_humana(p_telefone, p_texto, p_quando);
  end if;
  return r || jsonb_build_object('memoria', v_mem);
end $$;

create or replace function mayara.leitura_canal(p_canal text, p_estado_real text, p_agora timestamptz default now())
returns jsonb language plpgsql set search_path = '' as $$
#variable_conflict use_column
declare
  c mayara.canal_estado%rowtype;
  v_est text := lower(coalesce(p_estado_real, ''));
  v_acao text := 'nada';
  v_desde timestamptz;
  v_min int := 0;
  v_gravar text;
begin
  if coalesce((select valor from mayara.config where chave = 'canal_vigia'), 'false') <> 'true' then
    return jsonb_build_object('acao', 'nada', 'motivo', 'vigia_desligado');
  end if;
  if v_est not in ('open', 'connecting', 'close', 'inalcancavel') then
    return jsonb_build_object('acao', 'nada', 'motivo', 'leitura_invalida');
  end if;
  select * into c from mayara.canal_estado where canal_id = p_canal for update;
  if not found then
    return jsonb_build_object('acao', 'nada', 'motivo', 'canal_desconhecido');
  end if;

  if v_est = 'open' then
    if c.queda_desde is not null or c.estado <> 'open'
       or c.ultima_recuperacao_em is null or c.ultima_recuperacao_em <= p_agora - interval '15 minutes' then
      v_acao := 'recuperar';
      v_desde := greatest(coalesce(c.sincronizado_ate, p_agora - interval '30 minutes') - interval '10 minutes', p_agora - interval '48 hours');
    end if;
    update mayara.canal_estado
       set estado = 'open', atualizado_em = p_agora, ultimo_open_em = p_agora, queda_desde = null,
           tentativas_restart = 0, ultimo_restart_em = null, lembretes_enviados = 0, ultimo_lembrete_em = null,
           ultima_recuperacao_em = case when v_acao = 'recuperar' then p_agora else c.ultima_recuperacao_em end
     where canal_id = p_canal;
    return jsonb_build_object('acao', v_acao, 'desde', v_desde, 'minutos_fora', 0, 'tentativas', 0);
  end if;

  if c.queda_desde is null then
    c.queda_desde := p_agora;
  end if;
  v_min := floor(extract(epoch from (p_agora - c.queda_desde)) / 60)::int;
  if v_est = 'connecting' and v_min > 6 then
    v_est := 'close';
  end if;
  v_gravar := case when v_est = 'connecting' then 'connecting' else 'close' end;

  if v_est = 'close' and c.tentativas_restart < 3
     and (c.ultimo_restart_em is null or c.ultimo_restart_em <= p_agora - interval '4 minutes') then
    v_acao := 'reiniciar';
    c.tentativas_restart := c.tentativas_restart + 1;
    c.ultimo_restart_em := p_agora;
  elsif c.ultimo_lembrete_em is null
        and ((v_est = 'close' and c.tentativas_restart >= 3 and c.ultimo_restart_em <= p_agora - interval '4 minutes')
             or (v_est = 'inalcancavel' and v_min >= 6)) then
    v_acao := 'alertar';
    c.lembretes_enviados := 1;
    c.ultimo_lembrete_em := p_agora;
  elsif c.ultimo_lembrete_em is not null and c.ultimo_lembrete_em <= p_agora - interval '60 minutes'
        and c.lembretes_enviados < 12 then
    v_acao := 'lembrar';
    c.lembretes_enviados := c.lembretes_enviados + 1;
    c.ultimo_lembrete_em := p_agora;
  end if;

  update mayara.canal_estado
     set estado = v_gravar, atualizado_em = p_agora, queda_desde = c.queda_desde,
         tentativas_restart = c.tentativas_restart, ultimo_restart_em = c.ultimo_restart_em,
         lembretes_enviados = c.lembretes_enviados, ultimo_lembrete_em = c.ultimo_lembrete_em
   where canal_id = p_canal;
  return jsonb_build_object('acao', v_acao, 'desde', null, 'minutos_fora', v_min, 'tentativas', c.tentativas_restart);
end $$;

create or replace function mayara.concluir_recuperacao(p_canal text, p_ate timestamptz)
returns void language sql set search_path = '' as $$
  update mayara.canal_estado
     set sincronizado_ate = greatest(coalesce(sincronizado_ate, p_ate), p_ate)
   where canal_id = p_canal
$$;

revoke all on function mayara.marcar_mensagem_vista(text, text, text, text) from public, anon, authenticated;
revoke all on function mayara.mensagem_ja_vista(text, text) from public, anon, authenticated;
revoke all on function mayara.registrar_mensagem_humana(text, text, timestamptz) from public, anon, authenticated;
revoke all on function mayara.tratar_mensagem_humana(text, text, text, text, timestamptz) from public, anon, authenticated;
revoke all on function mayara.leitura_canal(text, text, timestamptz) from public, anon, authenticated;
revoke all on function mayara.concluir_recuperacao(text, timestamptz) from public, anon, authenticated;
