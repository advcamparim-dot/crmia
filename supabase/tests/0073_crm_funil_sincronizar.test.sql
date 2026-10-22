-- Rodar inteiro (execute_sql). Dados sinteticos (+5511999983xxx); termina em rollback.
begin;
do $t$
declare r record; n int;
begin
  insert into crm_sync.leads (id, name, status, created_at, modified_at, phone) values
    ('F-1', 'Respondeu', 'New', now(), now(), '+5511999983001'),
    ('F-2', 'Sem Interesse', 'New', now(), now(), '+5511999983002'),
    ('F-3', 'Assumido', 'New', now(), now(), '+5511999983003'),
    ('F-4', 'Ja Realizada', 'Consulta Realizada', now(), now(), '+5511999983004'),
    ('F-5', 'Agendou', 'New', now(), now(), '+5511999983005'),
    ('F-6', 'Nunca Respondeu', 'New', now(), now(), '+5511999983006'),
    ('F-7', 'Perdido ja Convertido', 'Converted', now(), now(), '+5511999983007'),
    ('F-8', 'Revertido pela equipe', 'In Process', now(), now(), '+5511999983008'),
    ('F-9', 'Ja Dead', 'Dead', now(), now(), '+5511999983009');
  insert into mayara.leads_autorizados (telefone, nome, origem, espocrm_lead_id, status) values
    ('+5511999983001', 'Respondeu', 'x', 'F-1', 'ativo'), ('+5511999983002', 'Sem Interesse', 'x', 'F-2', 'sem_interesse'),
    ('+5511999983003', 'Assumido', 'x', 'F-3', 'bloqueado'), ('+5511999983004', 'Ja Realizada', 'x', 'F-4', 'bloqueado'),
    ('+5511999983005', 'Agendou', 'x', 'F-5', 'ativo'), ('+5511999983006', 'Nunca', 'x', 'F-6', 'ativo'),
    ('+5511999983007', 'Convertido', 'x', 'F-7', 'sem_interesse'), ('+5511999983008', 'Revertido', 'x', 'F-8', 'sem_interesse'),
    ('+5511999983009', 'Dead', 'x', 'F-9', 'sem_interesse');
  insert into public.n8n_chat_histories (session_id, message) values
    ('whatsapp:escritorio:+5511999983001', '{"type":"human","content":"oi"}');
  insert into mayara.session_state (session_key, phone, estado, consulta_agendada_em) values
    ('whatsapp:escritorio:+5511999983005', '+5511999983005', 'S6_AGENDADO', now() + interval '2 days');

  select count(*) into n from mayara.crm_status_pendentes(100) where crm_lead_id like 'F-%';
  assert n = 0, 'desligado por padrao: nada pendente';
  update mayara.config set valor = 'ligado' where chave = 'crm_funil_modo';

  assert (select status_novo from mayara.crm_status_pendentes(100) where crm_lead_id = 'F-1') = 'In Process', 'respondeu: In Process';
  assert (select status_novo from mayara.crm_status_pendentes(100) where crm_lead_id = 'F-2') = 'Dead', 'sem interesse: Dead';
  assert (select motivo_perda from mayara.crm_status_pendentes(100) where crm_lead_id = 'F-2') = 'Sem Interesse', 'motivo de perda';
  assert (select status_novo from mayara.crm_status_pendentes(100) where crm_lead_id = 'F-3') = 'In Process', 'assumido pela equipe: In Process';
  assert not exists (select 1 from mayara.crm_status_pendentes(100) where crm_lead_id = 'F-4'), 'nunca recua: Consulta Realizada fica';
  assert (select status_novo from mayara.crm_status_pendentes(100) where crm_lead_id = 'F-5') = 'Consulta Agendada', 'agendou: Consulta Agendada';
  assert not exists (select 1 from mayara.crm_status_pendentes(100) where crm_lead_id = 'F-6'), 'nunca respondeu continua New';
  assert not exists (select 1 from mayara.crm_status_pendentes(100) where crm_lead_id = 'F-7'), 'Converted nunca vira Dead';
  assert not exists (select 1 from mayara.crm_status_pendentes(100) where crm_lead_id = 'F-9'), 'quem ja e Dead nao e tocado';
  assert (select status_novo from mayara.crm_status_pendentes(100) where crm_lead_id = 'F-8') = 'Dead', 'In Process com sem_interesse vira Dead (primeira vez)';

  perform mayara.crm_status_registrar('F-1', 'In Process', true, null);
  assert not exists (select 1 from mayara.crm_status_pendentes(100) where crm_lead_id = 'F-1'), 'aplicado uma vez nao repete';
  perform mayara.crm_status_registrar('F-8', 'Dead', true, null);
  update crm_sync.leads set status = 'In Process' where id = 'F-8';
  assert not exists (select 1 from mayara.crm_status_pendentes(100) where crm_lead_id = 'F-8'), 'se a equipe reverteu, a automacao nao briga';

  perform mayara.crm_status_registrar('F-2', 'Dead', false, 'http 500');
  perform mayara.crm_status_registrar('F-2', 'Dead', false, 'http 500');
  assert exists (select 1 from mayara.crm_status_pendentes(100) where crm_lead_id = 'F-2'), 'falha ainda tenta de novo';
  perform mayara.crm_status_registrar('F-2', 'Dead', false, 'http 500');
  assert not exists (select 1 from mayara.crm_status_pendentes(100) where crm_lead_id = 'F-2'), 'apos 3 falhas na hora, pausa';

  assert (select count(*) from mayara.crm_status_pendentes(2)) <= 2, 'respeita o limite';
  update mayara.config set valor = 'desligado' where chave = 'crm_funil_modo';
  assert not exists (select 1 from mayara.crm_status_pendentes(100)), 'desligar volta a zero';
  assert not has_function_privilege('anon', 'mayara.crm_status_pendentes(integer)', 'execute'), 'anon sem execute';
end $t$;
rollback;
select 'OK 0073' as resultado;
