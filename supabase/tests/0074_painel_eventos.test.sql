-- Rodar inteiro (execute_sql). Dados sinteticos (+5511999984xxx); termina em rollback.
begin;
do $t$
declare
  c timestamptz := now() - interval '10 days';
  k1 text := mayara.chave_telefone('+5511999984001'); k2 text := mayara.chave_telefone('+5511999984002');
  k3 text := mayara.chave_telefone('+5511999984003'); k4 text := mayara.chave_telefone('+5511999984004');
  k5 text := mayara.chave_telefone('+5511999984005');
  n1 int; n2 int;
begin
  insert into crm_sync.leads (id, name, status, created_at, modified_at, phone) values
    ('E-1', 'Completo', 'New', c, now(), '+5511999984001'),
    ('E-2', 'Perdido', 'New', c, now(), '+5511999984002'),
    ('E-3', 'Fora da lista', 'New', c, now(), '+5511999984003'),
    ('E-4', 'Duplicado A', 'New', c, now(), '+5511999984004'),
    ('E-5', 'Duplicado B', 'New', c + interval '1 day', now(), '+551199984004');
  insert into mayara.leads_autorizados (telefone, nome, origem, espocrm_lead_id, status) values
    ('+5511999984001', 'Completo', 'x', 'E-1', 'bloqueado'), ('+5511999984002', 'Perdido', 'x', 'E-2', 'sem_interesse');
  insert into mayara.envios_log (canal_id, destino_chave, tipo, ok, provedor_message_id, origem, criado_em) values
    ('escritorio', k1, 'texto', true, 'EV-1', 'ponte', c + interval '1 hour'),
    ('escritorio', k1, 'texto', true, 'EV-2', 'ponte', c + interval '2 hours'),
    ('escritorio', k1, 'texto', true, 'EV-3', 'followup', c + interval '1 hour'),
    ('escritorio', k2, 'texto', true, 'EV-4', 'alerta_escritorio', c + interval '1 hour');
  insert into mayara.canal_eventos (canal_id, provedor, resultado, remetente_chave, tipo, criado_em) values
    ('escritorio', 'evolution', 'aceito', k1, 'text', c + interval '3 hours'),
    ('escritorio', 'evolution', 'aceito', k1, 'text', c + interval '4 hours');
  insert into mayara.followups_log (chave, sequencia, etapa, estado, ciclo_saida, criado_em) values
    (k1, 'nunca_respondeu', 1, 'enviado', c, c + interval '1 day'), (k1, 'nunca_respondeu', 2, 'enviado', c, c + interval '2 days'),
    (k1, 'nunca_respondeu', 3, 'cancelado', c, c + interval '3 days');
  insert into mayara.session_state (session_key, phone, estado, consulta_agendada_em, updated_at) values
    ('whatsapp:escritorio:+5511999984001', '+5511999984001', 'S7_HANDOFF_HUMANO', now() + interval '1 day', c + interval '5 days');

  n1 := painel.eventos_atualizar();
  assert n1 >= 10, 'primeira rodada cria eventos: ' || n1;
  assert (select count(*) from painel.eventos where lead_chave = k1 and tipo = 'lead_criado') = 1, 'lead_criado uma vez';
  assert (select ocorrido_em from painel.eventos where lead_chave = k1 and tipo = 'primeira_mensagem') = c + interval '1 hour', 'primeira mensagem = a mais antiga de ponte/abordagem (follow-up nao conta)';
  assert (select ocorrido_em from painel.eventos where lead_chave = k1 and tipo = 'lead_respondeu') = c + interval '3 hours', 'primeira resposta do lead';
  assert (select count(*) from painel.eventos where lead_chave = k1 and tipo = 'followup_enviado') = 2, 'dois follow-ups enviados, o cancelado nao conta';
  assert (select count(distinct ref) from painel.eventos where lead_chave = k1 and tipo = 'followup_enviado') = 2, 'refs distintas por envio';
  assert exists (select 1 from painel.eventos where lead_chave = k1 and tipo = 'consulta_marcada' and detalhe ->> 'aprox' = 'true'), 'consulta marcada (aproximada)';
  assert exists (select 1 from painel.eventos where lead_chave = k1 and tipo = 'transferido_equipe'), 'transferido para a equipe';
  assert exists (select 1 from painel.eventos where lead_chave = k2 and tipo = 'perdido'), 'perdido';
  assert not exists (select 1 from painel.eventos where lead_chave = k2 and tipo = 'primeira_mensagem'), 'envio de alerta nao e mensagem da Mayara ao lead';
  assert (select array_agg(tipo order by tipo) from painel.eventos where lead_chave = k3) = array['lead_criado'], 'lead fora da lista so tem lead_criado';
  assert (select count(*) from painel.eventos where lead_chave = k4 and tipo = 'lead_criado') = 1, 'variante do telefone conta uma vez';
  assert (select ocorrido_em from painel.eventos where lead_chave = k4 and tipo = 'lead_criado') = c, 'fica a data mais antiga';

  n2 := painel.eventos_atualizar();
  assert n2 = 0, 'segunda rodada nao duplica: ' || n2;
  assert not has_function_privilege('anon', 'painel.eventos_atualizar()', 'execute'), 'anon sem execute';
  assert has_function_privilege('painel_leitura', 'painel.eventos_atualizar()', 'execute'), 'painel_leitura executa';
end $t$;
rollback;
select 'OK 0074' as resultado;
