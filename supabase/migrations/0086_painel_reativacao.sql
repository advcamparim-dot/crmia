-- Resumo da reativacao em massa para o painel (somente leitura).
create or replace function painel.reativacao_resumo()
returns table(leads integer, abordados integer, restantes integer, responderam integer, em_conversa integer, com_equipe integer,
              sem_interesse integer, consultas integer, followups integer, horas_ate_resposta numeric, primeiro_envio date, ultimo_envio date)
language sql stable set search_path = '' as $$
  with base as (
    select la.telefone_chave ch, la.status,
           (select min(p.encerrada_em) from mayara.propostas_abordagem p
             where p.telefone_chave = la.telefone_chave and p.lacuna = 'reativacao_massa' and p.estado = 'enviada') enviada_em
      from mayara.leads_autorizados la where la.origem = 'reativacao_massa'),
  m as (
    select b.*,
           (select min(e.quando) from painel._entradas() e where e.chave = b.ch and e.quando > b.enviada_em) primeira_resp,
           (select count(*) from mayara.envios_log l where l.destino_chave = b.ch and l.origem = 'followup' and l.ok and l.criado_em > b.enviada_em) fu,
           exists (select 1 from mayara.session_state s where mayara.chave_telefone(s.phone) = b.ch and s.consulta_agendada_em is not null) consulta
      from base b)
  select count(*)::integer,
         count(enviada_em)::integer,
         (count(*) filter (where enviada_em is null and status = 'ativo'))::integer,
         (count(*) filter (where primeira_resp is not null))::integer,
         (count(*) filter (where primeira_resp is not null and status = 'ativo'))::integer,
         (count(*) filter (where primeira_resp is not null and status = 'bloqueado'))::integer,
         (count(*) filter (where primeira_resp is not null and status = 'sem_interesse'))::integer,
         (count(*) filter (where consulta))::integer,
         coalesce(sum(fu), 0)::integer,
         round((avg(extract(epoch from (primeira_resp - enviada_em)) / 3600) filter (where primeira_resp is not null))::numeric, 1),
         (min(enviada_em) at time zone 'America/Sao_Paulo')::date,
         (max(enviada_em) at time zone 'America/Sao_Paulo')::date
    from m
$$;

revoke all on function painel.reativacao_resumo() from public, anon, authenticated;
grant execute on function painel.reativacao_resumo() to painel_leitura;
