-- Rodar inteiro (execute_sql). Dados sinteticos (+5511999993xxx); termina em rollback.
begin;
do $t$
declare
  hoje date := painel._hoje(); k1 text := mayara.chave_telefone('+5511999993001'); k2 text := mayara.chave_telefone('+5511999993002');
  k3 text := mayara.chave_telefone('+5511999993003'); k4 text := mayara.chave_telefone('+5511999993004');
  antes jsonb; depois jsonb; n int; r record;
begin
  select coalesce(jsonb_object_agg(etapa, quantidade), '{}'::jsonb) into antes from painel.leads_por_etapa();
  insert into mayara.leads_autorizados (telefone, nome, origem, status) values
    ('+5511999993001', 'Prop Ativa', 'x', 'bloqueado'), ('+5511999993002', 'Prop Respondeu', 'x', 'bloqueado'),
    ('+5511999993003', 'Prop Encerrada', 'x', 'bloqueado'), ('+5511999993004', 'Prop e Contrato', 'x', 'bloqueado');
  insert into mayara.proposta_enviada (telefone_chave, nome, enviada_em, estado) values
    (k1, 'Prop Ativa', hoje - 3, 'ativa'), (k2, 'Prop Respondeu', hoje - 5, 'respondeu'),
    (k3, 'Prop Encerrada', hoje - 40, 'encerrada'), (k4, 'Prop e Contrato', hoje - 10, 'ativa');
  perform painel.contrato_registrar('+5511999993004', 'Prop e Contrato', null, 1000, hoje, jsonb_build_array(jsonb_build_object('numero', 1, 'valor', 1000, 'vencimento', hoje + 30)));

  select jsonb_object_agg(etapa, quantidade) into depois from painel.leads_por_etapa();
  assert (depois ->> 'Proposta enviada')::int - coalesce((antes ->> 'Proposta enviada')::int, 0) = 2, 'Proposta enviada +2 (ativa e respondeu)';
  assert (depois ->> 'Contrato')::int - coalesce((antes ->> 'Contrato')::int, 0) = 1, 'Contrato +1 (o contrato ganha da proposta)';
  assert (depois ->> 'Com a equipe')::int - coalesce((antes ->> 'Com a equipe')::int, 0) = 1, 'Com a equipe +1 (proposta encerrada volta a bloqueado simples)';
  assert (select count(*) from painel.leads_por_etapa()) = 7, 'sete linhas';
  assert (select array_agg(etapa order by ordem) from (select etapa, row_number() over () as ordem from painel.leads_por_etapa()) x) = array['Novo', 'Em conversa', 'Consulta', 'Com a equipe', 'Proposta enviada', 'Contrato', 'Perdidos'], 'ordem das etapas';

  n := painel.eventos_atualizar();
  assert (select count(*) from painel.eventos where tipo = 'proposta_enviada' and lead_chave in (k1, k2, k3, k4)) = 4, 'um evento por proposta registrada';
  assert (select ocorrido_em from painel.eventos where tipo = 'proposta_enviada' and lead_chave = k1) = ((hoje - 3)::timestamp + interval '12 hours') at time zone 'America/Sao_Paulo', 'data da proposta ao meio-dia de Sao Paulo';
  assert painel.eventos_atualizar() = 0, 'idempotente';

  select * into r from painel.funil_periodo(((hoje - 6)::timestamp at time zone 'America/Sao_Paulo'), ((hoje + 1)::timestamp at time zone 'America/Sao_Paulo')) where etapa = 'Proposta enviada';
  assert r.entraram >= 2, 'entraram na etapa (k1 ha 3 dias e k2 ha 5): ' || r.entraram;
  select * into r from painel.funil_periodo(((hoje - 12)::timestamp at time zone 'America/Sao_Paulo'), ((hoje + 1)::timestamp at time zone 'America/Sao_Paulo')) where etapa = 'Proposta enviada';
  assert r.avancaram >= 1, 'quem fechou contrato depois da proposta avancou (k4): ' || r.avancaram;
  select * into r from painel.funil_periodo(((hoje - 1)::timestamp at time zone 'America/Sao_Paulo'), ((hoje + 1)::timestamp at time zone 'America/Sao_Paulo')) where etapa = 'Contrato';
  assert r.entraram >= 1, 'a etapa Contrato mostra o contrato de hoje';
  assert (select array_agg(etapa order by ordem) from painel.funil_periodo(now() - interval '1 day', now())) = array['Novo', 'Em conversa', 'Consulta', 'Com a equipe', 'Proposta enviada', 'Contrato'], 'seis etapas no funil';
end $t$;
rollback;
select 'OK 0083' as resultado;
