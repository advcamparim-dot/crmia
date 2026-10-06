-- supabase/migrations/0018_mayara_manutencao_diaria.sql
-- Retencao diaria dos dados operacionais da Mayara. Chamada por um workflow diario do n8n.
-- Prazos:
--   canal_eventos      90 dias  (registro de eventos do canal: remetente e tipo, sem o conteudo)
--   mensagens_buffer    7 dias  (somente as ja processadas)
--   crm_retry_failed   90 dias  (falhas permanentes de gravacao no CRM)
-- NAO apaga: envios_log e comandos_log (auditoria), memoria de conversa, sessoes e leads.

create or replace function mayara.manutencao_diaria()
returns jsonb language plpgsql set search_path = '' as $$
declare
  v_eventos int;
  v_buffer int;
  v_retry int;
begin
  v_eventos := mayara.limpar_eventos_canal(90);

  delete from mayara.mensagens_buffer
  where processado = true and recebido_em < now() - interval '7 days';
  get diagnostics v_buffer = row_count;

  delete from mayara.crm_retry_failed
  where criado_em < now() - interval '90 days';
  get diagnostics v_retry = row_count;

  return jsonb_build_object(
    'canal_eventos', v_eventos,
    'mensagens_buffer', v_buffer,
    'crm_retry_failed', v_retry);
end $$;

revoke all on function mayara.manutencao_diaria() from public, anon, authenticated;
