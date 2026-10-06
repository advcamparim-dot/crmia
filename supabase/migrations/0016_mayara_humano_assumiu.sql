-- supabase/migrations/0016_mayara_humano_assumiu.sql
-- Quando uma mensagem sai do numero do escritorio e NAO foi enviada pela Mayara (seu id nao esta em
-- envios_log), um humano assumiu a conversa: a Mayara para de responder esse lead (mesmo efeito do
-- /assumir) e o evento fica registrado, sem o texto da mensagem.

create or replace function mayara.humano_assumiu(p_canal_id text, p_telefone text, p_message_id text)
returns jsonb language plpgsql set search_path = '' as $$
declare
  v_chave text := mayara.chave_telefone(p_telefone);
  v_status text;
  v_acao text;
begin
  if p_message_id is not null and exists (
    select 1 from mayara.envios_log where provedor_message_id = p_message_id
  ) then
    v_acao := 'mayara';
  elsif v_chave is null then
    v_acao := 'telefone_invalido';
  else
    select status into v_status from mayara.leads_autorizados where telefone_chave = v_chave;
    if v_status = 'ativo' then
      perform mayara.assumir_lead(p_telefone);
      v_acao := 'assumido';
    else
      v_acao := 'ignorado';
    end if;
  end if;
  perform mayara.registrar_evento_canal(
    p_canal_id, 'evolution', 'descartado',
    case v_acao when 'assumido' then 'humano_assumiu'
                when 'mayara' then 'enviada_por_mim'
                when 'telefone_invalido' then 'telefone_invalido'
                else 'enviada_por_humano_sem_lead' end,
    p_telefone, null, null, null);
  return jsonb_build_object('acao', v_acao, 'status', v_status);
end $$;

revoke all on function mayara.humano_assumiu(text, text, text) from public, anon, authenticated;
