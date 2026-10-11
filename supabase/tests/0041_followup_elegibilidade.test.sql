-- supabase/tests/0041_followup_elegibilidade.test.sql
begin;
do $t$
declare ca text := mayara.chave_telefone('+5511999990931'); cb text := mayara.chave_telefone('+5511999990932');
        cs text := mayara.chave_telefone('+5511999990933'); cv text := mayara.chave_telefone('+5511999990934');
        cr text := mayara.chave_telefone('+5511999990935'); cp text := mayara.chave_telefone('+5511999990936');
        r record; n int; v_log bigint; j jsonb; t text;
begin
  insert into mayara.leads_autorizados (telefone, nome, status) values
    ('+5511999990931', 'Lead A Teste', 'ativo'), ('+5511999990932', 'Lead B Teste', 'ativo'), ('+5511999990933', 'Lead S3 Teste', 'ativo'),
    ('+5511999990934', 'Lead Antigo Teste', 'ativo'), ('+5511999990935', 'Lead Respondeu Teste', 'ativo'), ('+5511999990936', 'Lead Pausado Teste', 'ativo');
  insert into mayara.envios_log (canal_id, destino_chave, tipo, ok, origem, criado_em) values
    ('escritorio', ca, 'texto', true, 'ponte', '2026-10-05 10:00:00-03'),
    ('escritorio', cb, 'texto', true, 'abordagem_assistida', '2026-10-05 10:00:00-03'),
    ('escritorio', cs, 'texto', true, 'ponte', '2026-10-05 10:00:00-03'),
    ('escritorio', cv, 'texto', true, 'ponte', '2026-09-20 10:00:00-03'),
    ('escritorio', cr, 'texto', true, 'ponte', '2026-10-05 10:00:00-03'),
    ('escritorio', cp, 'texto', true, 'ponte', '2026-10-05 10:00:00-03'),
    ('escritorio', ca, 'texto', true, 'followup', '2026-10-05 11:00:00-03');
  insert into public.n8n_chat_histories (session_id, message, created_at) values
    ('whatsapp:escritorio:+5511999990931', '{"type":"human","content":"oi"}'::jsonb, '2026-10-05 09:50:00-03'),
    ('whatsapp:escritorio:+5511999990933', '{"type":"human","content":"oi"}'::jsonb, '2026-10-05 09:50:00-03'),
    ('whatsapp:escritorio:+5511999990934', '{"type":"human","content":"oi"}'::jsonb, '2026-09-20 09:50:00-03'),
    ('whatsapp:escritorio:+5511999990935', '{"type":"human","content":"oi"}'::jsonb, '2026-10-05 09:50:00-03'),
    ('whatsapp:escritorio:+5511999990935', '{"type":"human","content":"voltei"}'::jsonb, '2026-10-05 10:20:00-03'),
    ('whatsapp:escritorio:+5511999990936', '{"type":"human","content":"oi"}'::jsonb, '2026-10-05 09:50:00-03');
  insert into mayara.session_state (session_key, phone, estado) values ('whatsapp:escritorio:+5511999990933', '+5511999990933', 'S3_PRIORIDADE_JURIDICA');
  insert into mayara.followup_estado (chave, status, pausado_ate) values (cp, 'ativo', '2026-10-06 00:00:00-03');

  assert mayara._ultima_saida(ca) = '2026-10-05 10:00:00-03'::timestamptz, 'follow-up nao e pergunta';
  assert mayara._qtd_entradas(ca) = 1 and mayara._qtd_entradas(cb) = 0, 'entradas';

  select count(*) into n from mayara.followups_elegiveis('2026-10-05 10:29:00-03') where lead_chave = ca;
  assert n = 0, 'A antes de 30 min: ' || n;
  select * into r from mayara.followups_elegiveis('2026-10-05 10:31:00-03') where lead_chave = ca;
  assert r.lead_etapa = 1 and r.lead_sequencia = 'conversa', 'A etapa 1: ' || coalesce(r.lead_etapa::text, 'nulo');
  select * into r from mayara.followups_elegiveis('2026-10-05 12:05:00-03') where lead_chave = ca;
  assert r.lead_etapa = 2, 'A pula para a etapa 2 (mais recente devida): ' || coalesce(r.lead_etapa::text, 'nulo');
  select * into r from mayara.followups_elegiveis('2026-10-06 10:05:00-03') where lead_chave = ca;
  assert r.lead_etapa = 4, 'A no dia seguinte vai direto para a etapa 4: ' || coalesce(r.lead_etapa::text, 'nulo');

  select * into r from mayara.followups_elegiveis('2026-10-05 10:31:00-03') where lead_chave = cb;
  assert r.lead_sequencia = 'nunca_respondeu' and r.lead_etapa = 1, 'B etapa 1';

  select count(*) into n from mayara.followups_elegiveis('2026-10-05 12:05:00-03') where lead_chave = cs;
  assert n = 0, 'prioridade juridica fora: ' || n;
  select count(*) into n from mayara.followups_elegiveis('2026-10-05 12:05:00-03') where lead_chave = cr;
  assert n = 0, 'quem respondeu depois fica fora: ' || n;
  select count(*) into n from mayara.followups_elegiveis('2026-10-05 12:05:00-03') where lead_chave = cp;
  assert n = 0, 'pausado fora: ' || n;
  assert mayara._lead_excluido(cp, '2026-10-05 12:05:00-03') = 'pausado', 'motivo pausado';
  assert mayara._lead_excluido(cs) = 'excluido_seguranca', 'motivo seguranca';
  select count(*) into n from mayara.followups_elegiveis('2026-10-05 12:05:00-03') where lead_chave = cv;
  assert n = 0, 'lead antigo sem estado (mais de 7 dias) fora: ' || n;
  insert into mayara.followup_estado (chave, status) values (cv, 'ativo');
  select count(*) into n from mayara.followups_elegiveis('2026-10-05 12:05:00-03') where lead_chave = cv;
  assert n = 1, 'lead antigo com estado entra: ' || n;
  update mayara.followup_estado set status = 'encerrado' where chave = cv;
  select count(*) into n from mayara.followups_elegiveis('2026-10-05 12:05:00-03') where lead_chave = cv;
  assert n = 0, 'encerrado fora: ' || n;
  update mayara.leads_autorizados set status = 'sem_interesse' where telefone_chave = cb;
  select count(*) into n from mayara.followups_elegiveis('2026-10-05 12:05:00-03') where lead_chave = cb;
  assert n = 0, 'sem_interesse fora: ' || n;
  update mayara.leads_autorizados set status = 'ativo' where telefone_chave = cb;

  select count(*) into n from mayara.reservar_followups('2026-10-05 12:05:00-03', 10);
  assert n = 0, 'modo desligado nao reserva: ' || n;
  update mayara.config set valor = 'simulacao' where chave = 'followup_modo';
  select count(*) into n from mayara.reservar_followups('2026-10-05 05:00:00-03', 10);
  assert n = 0, 'fora da janela nao reserva: ' || n;
  select count(*) into n from mayara.reservar_followups('2026-10-11 12:00:00-03', 10);
  assert n = 0, 'domingo nao reserva: ' || n;
  select count(*) into n from mayara.reservar_followups('2026-10-05 12:05:00-03', 10) where lead_chave in (ca, cb);
  assert n = 2, 'reserva A e B: ' || n;
  select count(*) into n from mayara.reservar_followups('2026-10-05 12:05:00-03', 10);
  assert n = 0, 'segunda chamada nao reserva de novo: ' || n;
  assert (select count(*) from mayara.followups_log where estado = 'reservado' and chave in (ca, cb)) = 2, 'duas reservas';

  select id into v_log from mayara.followups_log where chave = ca and estado = 'reservado';
  j := mayara.followup_ainda_valido(v_log, '2026-10-05 12:05:00-03');
  assert (j ->> 'ok') = 'true', 'valido: ' || j::text;
  j := mayara.followup_ainda_valido(v_log, '2026-10-05 05:00:00-03');
  assert (j ->> 'motivo') = 'fora_janela', 'fora da janela: ' || j::text;
  insert into public.n8n_chat_histories (session_id, message, created_at) values ('whatsapp:escritorio:+5511999990931', '{"type":"human","content":"oi de novo"}'::jsonb, '2026-10-05 12:06:00-03');
  j := mayara.followup_ainda_valido(v_log, '2026-10-05 12:07:00-03');
  assert (j ->> 'motivo') = 'respondeu', 'respondeu: ' || j::text;
  j := mayara.followup_ainda_valido(999999999, '2026-10-05 12:07:00-03');
  assert (j ->> 'motivo') = 'reserva_invalida', 'reserva invalida: ' || j::text;

  perform mayara.registrar_followup(v_log, 'cancelado', null, null, 'respondeu');
  assert not exists (select 1 from mayara.followup_estado where chave = ca), 'cancelado nao cria estado';
  select id into v_log from mayara.followups_log where chave = cb and estado = 'reservado';
  perform mayara.registrar_followup(v_log, 'simulado', 'Texto simulado', 'fixo', null);
  -- registrar grava o horario real; os testes comparam com horarios simulados
  update mayara.followup_estado set ultimo_envio_em = '2026-10-05 12:05:00-03' where chave = cb;
  assert (select etapa_atual from mayara.followup_estado where chave = cb) = 2 and (select enviados_total from mayara.followup_estado where chave = cb) = 0, 'simulado avanca etapa e nao conta no teto';
  select count(*) into n from mayara.followups_elegiveis('2026-10-05 12:10:00-03') where lead_chave = cb;
  assert n = 0, 'apos o envio nao repete a mesma etapa: ' || n;
  select * into r from mayara.followups_elegiveis('2026-10-06 10:05:00-03') where lead_chave = cb;
  assert r.lead_etapa = 4, 'proxima etapa no dia seguinte (3 e 4 devidas, vale a mais recente): ' || coalesce(r.lead_etapa::text, 'nulo');
  assert mayara.reiniciar_simulacao() >= 1, 'reiniciar simulacao';
  assert (select etapa_atual from mayara.followup_estado where chave = cb) = 0, 'simulacao reiniciada';

  t := mayara.definir_texto_proximo('+5511999990932', 'Bom dia, Beta. Texto aprovado.');
  assert t like '%registrado%', 'definir texto: ' || t;
  select * into r from mayara.reservar_followups('2026-10-05 12:30:00-03', 10) where lead_chave = cb;
  assert r.texto_proximo = 'Bom dia, Beta. Texto aprovado.', 'reserva devolve o texto pre-aprovado: ' || coalesce(r.texto_proximo, 'nulo');
  perform mayara.registrar_followup(r.log_id, 'enviado', r.texto_proximo, 'fixo', null);
  assert (select texto_proximo from mayara.followup_estado where chave = cb) is null and (select enviados_total from mayara.followup_estado where chave = cb) = 1, 'enviado limpa o texto e conta';

  update mayara.followup_estado set enviados_total = 14 where chave = cb;
  select count(*) into n from mayara.followups_fechar_ciclos() where lead_chave = cb and motivo = 'teto';
  assert n = 1, 'fecha no teto: ' || n;
  assert (select status from mayara.followup_estado where chave = cb) = 'revisao_humana', 'revisao humana';
  select count(*) into n from mayara.followups_fechar_ciclos() where lead_chave = cb;
  assert n = 0, 'aviso uma unica vez: ' || n;
  select count(*) into n from mayara.followups_elegiveis('2026-10-07 12:00:00-03') where lead_chave = cb;
  assert n = 0, 'revisao humana nao recebe follow-up: ' || n;

  update mayara.followup_estado set status = 'ativo', enviados_total = 0, ultimo_envio_em = null where chave = cb;
  update mayara.config set valor = '1' where chave = 'followup_limite_hora';
  select count(*) into n from mayara.reservar_followups(now(), 10);
  assert n = 0, 'quota esgotada (ja ha registros na ultima hora): ' || n;

  assert mayara.followups_resumo('2026-10-05 00:00:00-03') like '%Simulados:%', 'resumo';
  assert not has_function_privilege('anon', 'mayara.reservar_followups(timestamptz,int)', 'execute'), 'anon reservar';
  assert not has_function_privilege('authenticated', 'mayara.registrar_followup(bigint,text,text,text,text)', 'execute'), 'authenticated registrar';
end $t$;
rollback;
select 'OK 0041' as resultado;
