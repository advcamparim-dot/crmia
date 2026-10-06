-- supabase/migrations/0021_mayara_devolver_lembrete.sql
-- O worker de lembretes reserva o estagio antes de enviar. Se o envio falha, devolve o estagio para o lembrete ser tentado de novo.
-- 'nenhum' e seguro: a escolha do proximo estagio e feita do mais proximo da consulta para o mais distante.
create or replace function mayara.devolver_lembrete(p_session_key text, p_estagio text)
returns boolean language plpgsql set search_path = '' as $$
declare n int;
begin
  update mayara.session_state set lembrete_consulta_estagio = 'nenhum'
  where session_key = p_session_key and lembrete_consulta_estagio = p_estagio and p_estagio <> 'nenhum';
  get diagnostics n = row_count;
  return n > 0;
end $$;

revoke all on function mayara.devolver_lembrete(text, text) from public, anon, authenticated;
