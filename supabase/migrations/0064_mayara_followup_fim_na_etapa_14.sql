-- A sequencia termina na etapa 14 para as duas sequencias (os 14 textos distintos); antes, nunca_respondeu ia ate a etapa 40.
create or replace function mayara.followups_elegiveis(p_agora timestamp with time zone default now())
returns table(lead_chave text, lead_sequencia text, lead_etapa integer, lead_ciclo timestamp with time zone, lead_devido timestamp with time zone, lead_nome text, lead_telefone text)
language plpgsql stable set search_path = '' as $$
declare
  v_teto int := coalesce((select valor::int from mayara.config where chave = 'followup_teto'), 14);
  v_intervalo int := coalesce((select valor::int from mayara.config where chave = 'followup_intervalo_minimo_min'), 25);
  v_dias int := coalesce((select valor::int from mayara.config where chave = 'followup_dias_entrada'), 7);
  v_ultima int := least(coalesce((select valor::int from mayara.config where chave = 'followup_teto'), 14), 14);
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
             where a.devido_em <= p_agora and a.etapa > c.etapa_efetiva and a.etapa <= v_ultima) as etapa_dev
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

create or replace function mayara.followups_fechar_ciclos()
returns table(lead_chave text, lead_nome text, enviados integer, motivo text)
language plpgsql set search_path = '' as $$
#variable_conflict use_column
declare v_teto int := coalesce((select valor::int from mayara.config where chave = 'followup_teto'), 14);
        v_ultima int := least(coalesce((select valor::int from mayara.config where chave = 'followup_teto'), 14), 14);
begin
  return query
  with alvo as (
    select fe.chave,
           case when fe.enviados_total >= v_teto then 'teto'
                when fe.etapa_atual >= v_ultima then 'etapas_esgotadas'
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

revoke all on function mayara.followups_elegiveis(timestamptz) from public, anon, authenticated;
revoke all on function mayara.followups_fechar_ciclos() from public, anon, authenticated;
