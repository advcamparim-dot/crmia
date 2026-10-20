-- Rodar inteiro (execute_sql). Dados sinteticos (+55119999913xx); termina em rollback.
-- Cada tipo da fila tem um caso em aberto e um resolvido; o teste filtra pelo telefone sintetico para nao depender dos dados reais.
begin;
do $t$
declare
  k1 text := mayara.chave_telefone('+5511999991301'); k2 text := mayara.chave_telefone('+5511999991302');
  k3 text := mayara.chave_telefone('+5511999991303'); k4 text := mayara.chave_telefone('+5511999991304');
  k7 text := mayara.chave_telefone('+5511999991307'); k8 text := mayara.chave_telefone('+5511999991308');
  k9 text := mayara.chave_telefone('+5511999991309'); k10 text := mayara.chave_telefone('+5511999991310');
  k11 text := mayara.chave_telefone('+5511999991311'); k15 text := mayara.chave_telefone('+5511999991315');
  k16 text := mayara.chave_telefone('+5511999991316');
  r record; n int; colunas text[];
begin
  insert into mayara.leads_autorizados (telefone, nome, status, espocrm_lead_id) values
    ('+5511999991301', 'Fila 01 esperando', 'bloqueado', 'crm-01'), ('+5511999991302', 'Fila 02 equipe respondeu', 'bloqueado', null),
    ('+5511999991303', 'Fila 03 saida depois', 'bloqueado', null), ('+5511999991304', 'Fila 04 ativo sem handoff', 'ativo', null),
    ('+5511999991305', 'Fila 05 transferido', 'ativo', null), ('+5511999991306', 'Fila 06 transferido resolvido', 'ativo', null),
    ('+5511999991307', 'Fila 07 assumido e transferido', 'bloqueado', null), ('+5511999991308', 'Fila 08 falha aberta', 'ativo', null),
    ('+5511999991309', 'Fila 09 falha e consulta depois', 'ativo', null), ('+5511999991310', 'Fila 10 falha e equipe depois', 'ativo', null),
    ('+5511999991311', 'Fila 11 falha e so Mayara depois', 'ativo', null), ('+5511999991312', 'Fila 12 consulta em 5h', 'ativo', null),
    ('+5511999991313', 'Fila 13 consulta em 30h', 'ativo', null), ('+5511999991314', 'Fila 14 consulta passada', 'ativo', null),
    ('+5511999991315', 'Fila 15 revisao humana', 'ativo', null), ('+5511999991316', 'Fila 16 follow-up ativo', 'ativo', null);

  insert into mayara.session_state (session_key, phone, estado, updated_at, consulta_agendada_em) values
    ('whatsapp:escritorio:+5511999991305', '+5511999991305', 'S7_HANDOFF_HUMANO', now() - interval '5 hours', null),
    ('whatsapp:escritorio:+5511999991306', '+5511999991306', 'S7_HANDOFF_HUMANO', now() - interval '5 hours', null),
    ('whatsapp:escritorio:+5511999991307', '+5511999991307', 'S7_HANDOFF_HUMANO', now() - interval '5 hours', null),
    ('whatsapp:escritorio:+5511999991309', '+5511999991309', 'S6_AGENDADO', now() - interval '1 hour', now() + interval '3 days'),
    ('whatsapp:escritorio:+5511999991312', '+5511999991312', 'S6_AGENDADO', now(), now() + interval '5 hours'),
    ('whatsapp:escritorio:+551199991312',  '+551199991312',  'S6_AGENDADO', now(), now() + interval '5 hours'),
    ('whatsapp:escritorio:+5511999991313', '+5511999991313', 'S6_AGENDADO', now(), now() + interval '30 hours'),
    ('whatsapp:escritorio:+5511999991314', '+5511999991314', 'S6_AGENDADO', now(), now() - interval '2 hours');

  insert into mayara.canal_eventos (canal_id, provedor, resultado, remetente_chave, tipo, criado_em) values
    ('escritorio', 'evolution', 'aceito', k1, 'text', now() - interval '3 hours'),
    ('escritorio', 'evolution', 'aceito', k2, 'text', now() - interval '3 hours'),
    ('escritorio', 'evolution', 'aceito', k3, 'text', now() - interval '3 hours'),
    ('escritorio', 'evolution', 'aceito', k4, 'text', now() - interval '3 hours'),
    ('escritorio', 'evolution', 'aceito', k7, 'text', now() - interval '2 hours');
  insert into mayara.envios_log (canal_id, destino_chave, tipo, ok, provedor_message_id, origem, criado_em) values
    ('escritorio', k3, 'texto', true, 'FL1', 'central', now() - interval '2 hours'),
    ('escritorio', k11, 'texto', true, 'FL2', 'ponte', now() - interval '30 minutes');
  insert into public.n8n_chat_histories (session_id, message, created_at) values
    ('whatsapp:escritorio:+5511999991302', '{"type":"ai","content":"Mensagem enviada por uma pessoa do escritório em hoje: oi"}', now() - interval '1 hour'),
    ('whatsapp:escritorio:+5511999991306', '{"type":"ai","content":"Mensagem enviada por uma pessoa do escritório em hoje: oi"}', now() - interval '1 hour'),
    ('whatsapp:escritorio:+5511999991310', '{"type":"ai","content":"Mensagem enviada por uma pessoa do escritório em hoje: confirmando"}', now() - interval '30 minutes');

  insert into painel.falhas_agendamento (telefone_chave, motivo, criada_em) values
    (k8, 'erro_desconhecido', now() - interval '2 hours'), (k9, 'erro_desconhecido', now() - interval '2 hours'),
    (k10, 'erro_desconhecido', now() - interval '2 hours'), (k11, 'erro_desconhecido', now() - interval '2 hours');
  insert into painel.falhas_agendamento (telefone_chave, motivo, criada_em, resolvida_em) values
    (k16, 'erro_desconhecido', now() - interval '2 hours', now() - interval '1 hour');

  insert into mayara.followup_estado (chave, status) values (k15, 'revisao_humana'), (k16, 'ativo');

  select * into r from painel.fila_atencao() where telefone = '+5511999991301';
  assert r.tipo = 'lead_esperando' and r.urgencia = 1, 'lead assumido que escreveu e ninguem respondeu: ' || coalesce(r.tipo, 'nao apareceu');
  assert r.crm_lead_id = 'crm-01' and r.telefone_fim = '1301' and r.lead_nome = 'Fila 01 esperando', 'dados do lead: ' || r::text;
  assert r.desde between now() - interval '3 hours 1 minute' and now() - interval '2 hours 59 minutes', 'desde = hora da ultima mensagem do lead';
  assert not exists (select 1 from painel.fila_atencao() where telefone = '+5511999991302'), 'resolvido: a equipe respondeu depois do lead';
  assert not exists (select 1 from painel.fila_atencao() where telefone = '+5511999991303'), 'resolvido: houve saida depois do lead';
  assert not exists (select 1 from painel.fila_atencao() where telefone = '+5511999991304'), 'lead ativo sem handoff nao entra na fila do time';

  select * into r from painel.fila_atencao() where telefone = '+5511999991305';
  assert r.tipo = 'transferencia' and r.urgencia = 2, 'transferencia em aberto: ' || coalesce(r.tipo, 'nao apareceu');
  assert not exists (select 1 from painel.fila_atencao() where telefone = '+5511999991306'), 'resolvido: a equipe escreveu depois da transferencia';
  select count(*) into n from painel.fila_atencao() where telefone = '+5511999991307';
  assert n = 1 and (select tipo from painel.fila_atencao() where telefone = '+5511999991307') = 'lead_esperando', 'lead assumido e transferido aparece uma vez, como lead_esperando';

  select * into r from painel.fila_atencao() where telefone = '+5511999991308';
  assert r.tipo = 'agendamento_falhou' and r.urgencia = 3, 'falha em aberto: ' || coalesce(r.tipo, 'nao apareceu');
  assert not exists (select 1 from painel.fila_atencao() where telefone = '+5511999991309' and tipo = 'agendamento_falhou'), 'resolvida: consulta marcada depois da falha';
  assert not exists (select 1 from painel.fila_atencao() where telefone = '+5511999991310'), 'resolvida: a equipe escreveu depois da falha';
  assert exists (select 1 from painel.fila_atencao() where telefone = '+5511999991311' and tipo = 'agendamento_falhou'), 'a resposta automatica da Mayara nao resolve a falha';
  assert not exists (select 1 from painel.fila_atencao() where telefone = '+5511999991316'), 'falha com resolvida_em nao aparece';

  select * into r from painel.fila_atencao() where telefone = '+5511999991312';
  assert r.tipo = 'consulta_24h' and r.urgencia = 4, 'consulta em 5 h: ' || coalesce(r.tipo, 'nao apareceu');
  assert r.detalhe like 'Consulta em %', 'detalhe traz o horario: ' || r.detalhe;
  assert (select count(*) from painel.fila_atencao() where telefone = '+5511999991312') = 1, 'lead com duas sessoes aparece uma vez';
  assert not exists (select 1 from painel.fila_atencao() where telefone = '+5511999991313'), 'consulta em 30 h fica de fora';
  assert not exists (select 1 from painel.fila_atencao() where telefone = '+5511999991314'), 'consulta passada fica de fora';

  select * into r from painel.fila_atencao() where telefone = '+5511999991315';
  assert r.tipo = 'fim_sequencia' and r.urgencia = 6, 'revisao humana: ' || coalesce(r.tipo, 'nao apareceu');
  update mayara.followup_estado set status = 'ativo' where chave = k15;
  assert not exists (select 1 from painel.fila_atencao() where telefone = '+5511999991315'), 'resolvido: voltou a ativo';
  update mayara.followup_estado set status = 'encerrado' where chave = k15;
  assert not exists (select 1 from painel.fila_atencao() where telefone = '+5511999991315'), 'resolvido: encerrado';

  assert not exists (select 1 from painel.fila_atencao() where tipo = 'canal') or (select estado from mayara.canal_estado where canal_id = 'escritorio') <> 'open', 'canal aberto nao gera item';
  update mayara.canal_estado set estado = 'close' where canal_id = 'escritorio';
  select * into r from painel.fila_atencao() where tipo = 'canal';
  assert r.urgencia = 7 and r.lead_nome is null and r.detalhe like 'WhatsApp%', 'canal fora do ar: ' || coalesce(r.detalhe, 'nao apareceu');

  assert (select array_agg(urgencia order by ord) = array_agg(urgencia order by urgencia, desde) from (select urgencia, desde, row_number() over () as ord from painel.fila_atencao()) x),
         'ordenada por urgencia e depois por desde';
  select proargnames into colunas from pg_proc where oid = 'painel.fila_atencao()'::regprocedure;
  assert not (colunas && array['texto', 'mensagem', 'conteudo', 'message', 'content']), 'nenhuma coluna de texto de conversa: ' || colunas::text;

  assert not has_function_privilege('anon', 'painel.fila_atencao()', 'execute'), 'anon sem execute';
  assert not has_function_privilege('authenticated', 'painel.fila_atencao()', 'execute'), 'authenticated sem execute';
end $t$;
rollback;
select 'OK 0068' as resultado;
