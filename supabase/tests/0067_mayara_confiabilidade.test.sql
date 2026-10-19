-- Rodar inteiro (execute_sql). Dados ficticios; termina em rollback.
begin;
do $t$
declare
  r record;
  agora timestamptz := timestamptz '2026-10-19 13:00:00+00';
begin
  update mayara.config set valor = 'simulacao' where chave = 'followup_modo';

  -- Uma saida automatica inicia a regua; resposta humana posterior a bloqueia.
  insert into mayara.leads_autorizados (telefone, nome, status)
    values ('+5511999990651', 'Followup Auto Teste', 'ativo');
  insert into mayara.envios_log (canal_id, destino_chave, tipo, ok, provedor_message_id, origem, criado_em)
    values ('escritorio', mayara.chave_telefone('+5511999990651'), 'texto', true, 'AUTO-0651', 'abordagem_automatica', agora - interval '2 hours');
  select * into r from mayara.followups_elegiveis(agora)
    where lead_chave = mayara.chave_telefone('+5511999990651');
  assert r.lead_sequencia = 'nunca_respondeu' and r.lead_etapa is not null, 'saida automatica entra na regua';
  insert into public.n8n_chat_histories (session_id, message, created_at)
    values ('whatsapp:escritorio:+5511999990651', jsonb_build_object('type', 'human', 'content', 'Oi'), agora - interval '1 hour');
  assert not exists (
    select 1 from mayara.followups_elegiveis(agora)
    where lead_chave = mayara.chave_telefone('+5511999990651')
  ), 'resposta humana bloqueia follow-up automatico';

end $t$;
rollback;
select 'OK 0067' as resultado;
