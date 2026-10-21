-- Rodar inteiro (execute_sql). Dados sinteticos (+5511999982xxx); termina em rollback.
begin;
do $t$
declare
  c timestamptz := '2026-12-07 09:00:00-03'; -- segunda
  f timestamptz[]; i int; n int;
  k_frio text := mayara.chave_telefone('+5511999982001');
  k_nr text := mayara.chave_telefone('+5511999982002');
  k_conv text := mayara.chave_telefone('+5511999982003');
begin
  select array_agg(devido_em order by etapa) into f from mayara.agenda_followup('frio', c) where etapa <= 14;
  assert array_length(f, 1) = 14, '14 etapas na sequencia frio';
  assert f[1] = '2026-12-08 10:00:00-03', 'dia util 1, manha (10h)';
  assert f[2] = '2026-12-09 16:00:00-03', 'dia util 2, tarde (16h)';
  assert f[3] = '2026-12-10 10:00:00-03', 'dia util 3, manha';
  assert f[4] = '2026-12-11 16:00:00-03', 'dia util 4, tarde';
  for i in 2..14 loop assert f[i] > f[i - 1], 'crescente na etapa ' || i; end loop;
  select count(*) - count(distinct (d at time zone 'America/Sao_Paulo')::date) into n from unnest(f) d;
  assert n = 0, 'exatamente um toque por dia';
  assert (select bool_and(case when e % 2 = 1 then extract(hour from f[e] at time zone 'America/Sao_Paulo') = 10 else extract(hour from f[e] at time zone 'America/Sao_Paulo') = 16 end) from generate_series(1, 14) e), 'impares de manha, pares de tarde';
  assert (select bool_and(mayara._janela_aberta(d, 'followup')) from unnest(f) d), 'todos dentro da janela de follow-up';
  assert (select count(*) from mayara.regua_followup where sequencia = 'frio') = 14, 'tabela com 14 linhas';

  -- reativacao enviada no sabado: o dia 1 e a segunda
  select array_agg(devido_em order by etapa) into f from mayara.agenda_followup('frio', '2026-12-12 07:00:00-03') where etapa <= 2;
  assert f[1] = '2026-12-14 10:00:00-03', 'enviado no sabado: dia util 1 e a segunda 10h';

  -- sequencia escolhida por lead
  insert into mayara.leads_autorizados (telefone, nome, origem) values
    ('+5511999982001', 'Frio Teste', 'reativacao_massa'),
    ('+5511999982002', 'Nunca Respondeu Teste', 'landing_campanha_pj'),
    ('+5511999982003', 'Conversa Teste', 'reativacao_massa');
  insert into mayara.envios_log (canal_id, destino_chave, tipo, ok, provedor_message_id, origem, criado_em) values
    ('escritorio', k_frio, 'texto', true, 'T-F', 'abordagem_automatica', c),
    ('escritorio', k_nr, 'texto', true, 'T-N', 'abordagem_automatica', c),
    ('escritorio', k_conv, 'texto', true, 'T-C', 'abordagem_automatica', c - interval '3 hours');
  insert into mayara.envios_log (canal_id, destino_chave, tipo, ok, provedor_message_id, origem, criado_em) values
    ('escritorio', k_conv, 'texto', true, 'T-C2', 'ponte', c);
  insert into public.n8n_chat_histories (session_id, message, created_at) values
    ('whatsapp:escritorio:+5511999982003', '{"type":"human","content":"oi"}', c - interval '2 hours');
  assert (select lead_sequencia from mayara.followups_elegiveis(c + interval '2 days') where lead_chave = k_frio) = 'frio', 'lead da reativacao sem resposta usa a regua frio';
  assert (select lead_etapa from mayara.followups_elegiveis(c + interval '2 days') where lead_chave = k_frio) = 1, 'dois dias depois (9h) so venceu o toque do dia 1 (o do dia 2 e as 16h)';
  assert (select lead_etapa from mayara.followups_elegiveis(c + interval '2 days 8 hours') where lead_chave = k_frio) = 2, 'as 17h do dia 2 vence o toque 2';
  assert (select lead_sequencia from mayara.followups_elegiveis(c + interval '2 days') where lead_chave = k_nr) = 'nunca_respondeu', 'lead comum continua em nunca_respondeu';
  assert (select lead_sequencia from mayara.followups_elegiveis(c + interval '2 days') where lead_chave = k_conv) = 'conversa', 'quem respondeu cai em conversa mesmo vindo da reativacao';
  assert not exists (select 1 from mayara.followups_elegiveis(c + interval '1 hour') where lead_chave = k_frio), 'no mesmo dia da reativacao nada vence';
end $t$;
rollback;
select 'OK 0072' as resultado;
