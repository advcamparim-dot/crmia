-- Regua de follow-up: quem esta elegivel, reserva atomica, registro, revalidacao, teto e resumo.

create or replace function mayara._ultima_entrada(p_chave text)
returns timestamptz language sql stable set search_path = '' as $$
  select max(h.created_at) from public.n8n_chat_histories h
   where h.message ->> 'type' = 'human'
     and mayara.chave_telefone(substring(h.session_id from '[+0-9]+$')) = p_chave
$$;

create or replace function mayara._qtd_entradas(p_chave text)
returns bigint language sql stable set search_path = '' as $$
  select count(*) from public.n8n_chat_histories h
   where h.message ->> 'type' = 'human'
     and mayara.chave_telefone(substring(h.session_id from '[+0-9]+$')) = p_chave
$$;

create or replace function mayara._ultima_saida(p_chave text)
returns timestamptz language sql stable set search_path = '' as $$
  select max(l.criado_em) from mayara.envios_log l
   where l.destino_chave = p_chave and l.ok and l.origem in ('ponte', 'abordagem_assistida', 'reativacao')
$$;

-- motivo pelo qual o lead nao pode receber follow-up, ou null
create or replace function mayara._lead_excluido(p_chave text, p_agora timestamptz default now())
returns text language plpgsql stable set search_path = '' as $$
declare fe mayara.followup_estado%rowtype;
begin
  if not exists (select 1 from mayara.leads_autorizados la where la.telefone_chave = p_chave and la.status = 'ativo') then
    return 'lead_inativo';
  end if;
  if exists (select 1 from mayara.administradores a where a.telefone_chave = p_chave) then
    return 'administrador';
  end if;
  if exists (select 1 from mayara.session_state s
              where mayara.chave_telefone(s.phone) = p_chave
                and (s.estado in ('S3_PRIORIDADE_JURIDICA', 'S6_AGENDADO', 'S7_HANDOFF_HUMANO')
                     or s.consulta_agendada_em is not null
                     or coalesce(s.fatos_json ->> 'situacaoJudicial', 'nenhuma') in
                        ('execucao', 'execução', 'recuperacao_judicial', 'recuperação_judicial', 'falencia', 'falência'))) then
    return 'excluido_seguranca';
  end if;
  select * into fe from mayara.followup_estado where chave = p_chave;
  if found then
    if fe.status <> 'ativo' then
      return fe.status;
    end if;
    if fe.pausado_ate is not null and fe.pausado_ate > p_agora then
      return 'pausado';
    end if;
  end if;
  return null;
end $$;

create or replace function mayara.followups_elegiveis(p_agora timestamptz default now())
returns table (lead_chave text, lead_sequencia text, lead_etapa int, lead_ciclo timestamptz, lead_devido timestamptz, lead_nome text, lead_telefone text)
language plpgsql stable set search_path = '' as $$
declare
  v_teto int := coalesce((select valor::int from mayara.config where chave = 'followup_teto'), 14);
  v_intervalo int := coalesce((select valor::int from mayara.config where chave = 'followup_intervalo_minimo_min'), 25);
  v_dias int := coalesce((select valor::int from mayara.config where chave = 'followup_dias_entrada'), 7);
begin
  return query
  with base as (
    select la.telefone_chave as chave, la.nome, la.telefone,
           mayara._ultima_saida(la.telefone_chave) as ciclo_saida,
           mayara._ultima_entrada(la.telefone_chave) as entrada,
           mayara._qtd_entradas(la.telefone_chave) as n_entradas
      from mayara.leads_autorizados la where la.status = 'ativo'
  ), silenciosos as (
    select b.*, case when b.n_entradas = 0 then 'nunca_respondeu' else 'conversa' end as sequencia
      from base b
     where b.ciclo_saida is not null and (b.entrada is null or b.ciclo_saida > b.entrada)
  ), com_estado as (
    select s.*, fe.enviados_total, fe.ultimo_envio_em, (fe.chave is not null) as tem_estado,
           case when fe.ciclo_saida = s.ciclo_saida then fe.etapa_atual else 0 end as etapa_efetiva
      from silenciosos s left join mayara.followup_estado fe on fe.chave = s.chave
  ), candidatos as (
    select c.*,
           (select max(a.etapa) from mayara.agenda_followup(c.sequencia, c.ciclo_saida) a
             where a.devido_em <= p_agora and a.etapa > c.etapa_efetiva) as etapa_dev
      from com_estado c
     where coalesce(c.enviados_total, 0) < v_teto
       and (c.ultimo_envio_em is null or p_agora - c.ultimo_envio_em >= make_interval(mins => v_intervalo))
       and (c.tem_estado or c.ciclo_saida >= p_agora - make_interval(days => v_dias))
       and mayara._lead_excluido(c.chave, p_agora) is null
  )
  select c.chave, c.sequencia, c.etapa_dev, c.ciclo_saida,
         (select a.devido_em from mayara.agenda_followup(c.sequencia, c.ciclo_saida) a where a.etapa = c.etapa_dev),
         c.nome, c.telefone
    from candidatos c where c.etapa_dev is not null;
end $$;

create or replace function mayara.reservar_followups(p_agora timestamptz default now(), p_limite int default 5)
returns table (log_id bigint, lead_chave text, lead_sequencia text, lead_etapa int, lead_ciclo timestamptz,
               lead_nome text, lead_telefone text, modo text, texto_proximo text)
language plpgsql set search_path = '' as $$
#variable_conflict use_column
declare
  v_modo text := coalesce((select valor from mayara.config where chave = 'followup_modo'), 'desligado');
  v_quota int;
  v_n int;
begin
  if v_modo not in ('simulacao', 'ligado') then
    return;
  end if;
  if not mayara.followup_permitido(p_agora) then
    return;
  end if;
  v_quota := coalesce((select valor::int from mayara.config where chave = 'followup_limite_hora'), 15)
           - (select count(*) from mayara.followups_log f
               where f.estado in ('enviado', 'simulado', 'reservado') and f.criado_em > p_agora - interval '1 hour');
  v_n := least(p_limite, v_quota);
  if v_n <= 0 then
    return;
  end if;
  return query
  with e as (
    select x.* from mayara.followups_elegiveis(p_agora) x
     where not exists (select 1 from mayara.followups_log f
                        where f.chave = x.lead_chave and f.ciclo_saida = x.lead_ciclo and f.etapa = x.lead_etapa and f.estado = 'falhou'
                       having count(*) >= 3)
     order by x.lead_devido, x.lead_chave
     limit v_n
  ), ins as (
    insert into mayara.followups_log (chave, sequencia, etapa, estado, ciclo_saida)
    select e.lead_chave, e.lead_sequencia, e.lead_etapa, 'reservado', e.lead_ciclo from e
    on conflict (chave) where estado = 'reservado' do nothing
    returning id, chave, sequencia, etapa, ciclo_saida
  )
  select ins.id, ins.chave, ins.sequencia, ins.etapa, ins.ciclo_saida, e.lead_nome, e.lead_telefone, v_modo,
         (select fe.texto_proximo from mayara.followup_estado fe where fe.chave = ins.chave and fe.ciclo_saida = ins.ciclo_saida)
    from ins join e on e.lead_chave = ins.chave;
end $$;

create or replace function mayara.followup_ainda_valido(p_log_id bigint, p_agora timestamptz default now())
returns jsonb language plpgsql stable set search_path = '' as $$
declare f mayara.followups_log%rowtype; v_exc text; v_entrada timestamptz;
begin
  select * into f from mayara.followups_log where id = p_log_id and estado = 'reservado';
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'reserva_invalida');
  end if;
  if not mayara.followup_permitido(p_agora) then
    return jsonb_build_object('ok', false, 'motivo', 'fora_janela');
  end if;
  v_exc := mayara._lead_excluido(f.chave, p_agora);
  if v_exc is not null then
    return jsonb_build_object('ok', false, 'motivo', v_exc);
  end if;
  v_entrada := mayara._ultima_entrada(f.chave);
  if v_entrada is not null and v_entrada > f.ciclo_saida then
    return jsonb_build_object('ok', false, 'motivo', 'respondeu');
  end if;
  if mayara._ultima_saida(f.chave) is distinct from f.ciclo_saida then
    return jsonb_build_object('ok', false, 'motivo', 'novo_ciclo');
  end if;
  return jsonb_build_object('ok', true);
end $$;

create or replace function mayara.registrar_followup(p_log_id bigint, p_estado text, p_texto text, p_fonte text, p_motivo text)
returns void language plpgsql set search_path = '' as $$
declare f mayara.followups_log%rowtype;
begin
  if p_estado not in ('enviado', 'simulado', 'cancelado', 'falhou') then
    raise exception 'estado invalido: %', p_estado;
  end if;
  update mayara.followups_log
     set estado = p_estado, texto = p_texto, fonte = p_fonte, motivo = left(p_motivo, 300), atualizado_em = now()
   where id = p_log_id and estado = 'reservado'
  returning * into f;
  if not found then
    return;
  end if;
  if p_estado in ('enviado', 'simulado') then
    insert into mayara.followup_estado (chave, ciclo_saida, etapa_atual, enviados_total, ultimo_envio_em)
    values (f.chave, f.ciclo_saida, f.etapa, case when p_estado = 'enviado' then 1 else 0 end, now())
    on conflict (chave) do update
       set ciclo_saida = excluded.ciclo_saida,
           etapa_atual = excluded.etapa_atual,
           enviados_total = mayara.followup_estado.enviados_total + case when p_estado = 'enviado' then 1 else 0 end,
           ultimo_envio_em = excluded.ultimo_envio_em,
           texto_proximo = null,
           atualizado_em = now();
  end if;
end $$;

create or replace function mayara.definir_texto_proximo(p_telefone text, p_texto text)
returns text language plpgsql set search_path = '' as $$
declare v_chave text := mayara.chave_telefone(p_telefone); v_ciclo timestamptz;
begin
  if v_chave is null or btrim(coalesce(p_texto, '')) = '' then
    return 'Telefone ou texto inválido.';
  end if;
  v_ciclo := mayara._ultima_saida(v_chave);
  insert into mayara.followup_estado (chave, ciclo_saida, etapa_atual, texto_proximo)
  values (v_chave, v_ciclo, 0, btrim(p_texto))
  on conflict (chave) do update
     set texto_proximo = btrim(p_texto),
         ciclo_saida = coalesce(mayara.followup_estado.ciclo_saida, excluded.ciclo_saida),
         atualizado_em = now();
  return 'Texto do próximo follow-up registrado.';
end $$;

-- fecha a regua de quem atingiu o teto ou esgotou as etapas; devolve quem precisa de aviso (uma unica vez)
create or replace function mayara.followups_fechar_ciclos()
returns table (lead_chave text, lead_nome text, enviados int, motivo text)
language plpgsql set search_path = '' as $$
#variable_conflict use_column
declare v_teto int := coalesce((select valor::int from mayara.config where chave = 'followup_teto'), 14);
begin
  return query
  with alvo as (
    select fe.chave,
           case when fe.enviados_total >= v_teto then 'teto'
                when mayara._qtd_entradas(fe.chave) > 0
                     and fe.etapa_atual >= (select max(g.etapa) from mayara.regua_followup g where g.sequencia = 'conversa') then 'etapas_esgotadas'
           end as motivo
      from mayara.followup_estado fe where fe.status = 'ativo'
  ), u as (
    update mayara.followup_estado fe set status = 'revisao_humana', atualizado_em = now()
      from alvo where fe.chave = alvo.chave and alvo.motivo is not null
    returning fe.chave, fe.enviados_total, alvo.motivo
  )
  select u.chave, (select la.nome from mayara.leads_autorizados la where la.telefone_chave = u.chave limit 1),
         u.enviados_total, u.motivo
    from u;
end $$;

create or replace function mayara.reiniciar_simulacao()
returns int language plpgsql set search_path = '' as $$
declare n int;
begin
  update mayara.followup_estado fe
     set etapa_atual = coalesce((select max(f.etapa) from mayara.followups_log f
                                  where f.chave = fe.chave and f.ciclo_saida = fe.ciclo_saida and f.estado = 'enviado'), 0),
         ultimo_envio_em = (select max(f.atualizado_em) from mayara.followups_log f
                             where f.chave = fe.chave and f.ciclo_saida = fe.ciclo_saida and f.estado = 'enviado'),
         atualizado_em = now()
   where exists (select 1 from mayara.followups_log f where f.chave = fe.chave and f.estado = 'simulado');
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function mayara.followups_resumo(p_desde timestamptz)
returns text language plpgsql stable set search_path = '' as $$
declare v_env int; v_sim int; v_fal int; v_can int; v_resp int; v_rev int;
begin
  select count(*) filter (where estado = 'enviado'), count(*) filter (where estado = 'simulado'),
         count(*) filter (where estado = 'falhou'), count(*) filter (where estado = 'cancelado')
    into v_env, v_sim, v_fal, v_can
    from mayara.followups_log where criado_em >= p_desde;
  select count(distinct f.chave) into v_resp
    from mayara.followups_log f
   where f.estado = 'enviado' and f.criado_em >= p_desde
     and mayara._ultima_entrada(f.chave) > f.atualizado_em;
  select count(*) into v_rev from mayara.followup_estado where status = 'revisao_humana';
  return 'Follow-ups desde ' || to_char(p_desde at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI') || E':\n'
    || 'Enviados: ' || v_env || E'\nSimulados: ' || v_sim || E'\nFalhas: ' || v_fal || E'\nCancelados na conferência: ' || v_can
    || E'\nLeads que responderam depois de um follow-up: ' || v_resp || E'\nParados em revisão humana: ' || v_rev;
end $$;

revoke all on function mayara._ultima_entrada(text) from public, anon, authenticated;
revoke all on function mayara._qtd_entradas(text) from public, anon, authenticated;
revoke all on function mayara._ultima_saida(text) from public, anon, authenticated;
revoke all on function mayara._lead_excluido(text, timestamptz) from public, anon, authenticated;
revoke all on function mayara.followups_elegiveis(timestamptz) from public, anon, authenticated;
revoke all on function mayara.reservar_followups(timestamptz, int) from public, anon, authenticated;
revoke all on function mayara.followup_ainda_valido(bigint, timestamptz) from public, anon, authenticated;
revoke all on function mayara.registrar_followup(bigint, text, text, text, text) from public, anon, authenticated;
revoke all on function mayara.definir_texto_proximo(text, text) from public, anon, authenticated;
revoke all on function mayara.followups_fechar_ciclos() from public, anon, authenticated;
revoke all on function mayara.reiniciar_simulacao() from public, anon, authenticated;
revoke all on function mayara.followups_resumo(timestamptz) from public, anon, authenticated;
