-- Rodar inteiro (execute_sql). Eventos inseridos a mao (chaves 119999850xx); termina em rollback.
begin;
do $t$
declare
  d0 timestamptz := '2099-03-01 00:00:00-03'; d1 timestamptz := '2099-03-08 00:00:00-03';
  r record;
begin
  -- A: criado, respondeu, consulta (avancou ate Consulta); B: criado e perdido sem responder; C: criado, respondeu, perdido depois;
  -- D: criado fora do periodo; E: criado, respondeu, transferido; F: criado na fronteira (== ate, fora); G: criado na fronteira (== de, dentro)
  insert into painel.eventos (lead_chave, tipo, ocorrido_em) values
    ('1199985001', 'lead_criado', d0 + interval '1 day'), ('1199985001', 'lead_respondeu', d0 + interval '2 days'), ('1199985001', 'consulta_marcada', d0 + interval '3 days'),
    ('1199985002', 'lead_criado', d0 + interval '1 day'), ('1199985002', 'perdido', d0 + interval '4 days'),
    ('1199985003', 'lead_criado', d0 + interval '1 day'), ('1199985003', 'lead_respondeu', d0 + interval '2 days'), ('1199985003', 'perdido', d0 + interval '5 days'),
    ('1199985004', 'lead_criado', d0 - interval '1 second'),
    ('1199985005', 'lead_criado', d0 + interval '2 days'), ('1199985005', 'lead_respondeu', d0 + interval '2 days'), ('1199985005', 'transferido_equipe', d0 + interval '3 days'),
    ('1199985006', 'lead_criado', d1),
    ('1199985007', 'lead_criado', d0);
  select * into r from painel.funil_periodo(d0, d1) where etapa = 'Novo';
  assert r.entraram = 5, 'Novo: A,B,C,E,G entraram (D antes, F na fronteira final): ' || r.entraram;
  assert r.avancaram = 3, 'Novo: A,C,E responderam: ' || r.avancaram;
  assert r.perderam = 1, 'Novo: so B perdeu antes de responder (C avancou): ' || r.perderam;
  select * into r from painel.funil_periodo(d0, d1) where etapa = 'Em conversa';
  assert r.entraram = 3 and r.avancaram = 2 and r.perderam = 1, 'Em conversa: A,C,E; avancaram A (consulta) e E (equipe); C perdeu aqui: ' || r::text;
  select * into r from painel.funil_periodo(d0, d1) where etapa = 'Consulta';
  assert r.entraram = 1 and r.avancaram = 0 and r.perderam = 0, 'Consulta: so A, ainda sem contrato';
  select * into r from painel.funil_periodo(d0, d1) where etapa = 'Com a equipe';
  assert r.entraram = 1 and r.avancaram = 0, 'Com a equipe: so E';
  select * into r from painel.funil_periodo(d0, d1) where etapa = 'Contrato';
  assert r.entraram = 0, 'sem contratos ainda';
  assert (select count(*) from painel.funil_periodo(d0, d1)) = 5, 'sempre cinco etapas';
  assert (select array_agg(etapa order by ordem) from painel.funil_periodo(d0, d1)) = array['Novo', 'Em conversa', 'Consulta', 'Com a equipe', 'Contrato'], 'ordem das etapas';
  assert (select count(*) from painel.funil_periodo(d0 + interval '100 years', d1 + interval '100 years') where entraram = 0) = 5, 'periodo vazio: tudo zero (dado real vazio, nao falha)';

  insert into painel.eventos (lead_chave, tipo, ocorrido_em) values ('1199985001', 'contrato_fechado', d0 + interval '6 days');
  select * into r from painel.funil_periodo(d0, d1) where etapa = 'Consulta';
  assert r.avancaram = 1, 'contrato depois da consulta: A avancou';
  select * into r from painel.funil_periodo(d0, d1) where etapa = 'Contrato';
  assert r.entraram = 1, 'contrato entrou';

  assert (select agora from painel.funil_periodo(d0, d1) where etapa = 'Novo') = (select quantidade from painel.leads_por_etapa() where etapa = 'Novo'), 'agora = leads_por_etapa';
  assert not has_function_privilege('anon', 'painel.funil_periodo(timestamptz, timestamptz)', 'execute'), 'anon sem execute';
end $t$;
rollback;
select 'OK 0075' as resultado;
