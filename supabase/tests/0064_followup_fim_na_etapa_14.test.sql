-- Rodar inteiro (execute_sql). Dados ficticios; termina em rollback.
begin;
do $t$
declare cb text := mayara.chave_telefone('+5511999990961'); cc text := mayara.chave_telefone('+5511999990962');
        r record; n int; f record;
begin
  insert into mayara.leads_autorizados (telefone, nome, status) values ('+5511999990961', 'Fim Nunca', 'ativo'), ('+5511999990962', 'Fim Conversa', 'ativo');
  insert into mayara.envios_log (canal_id, destino_chave, tipo, ok, origem, criado_em) values
    ('escritorio', cb, 'texto', true, 'abordagem_assistida', '2026-10-05 10:00:00-03'),
    ('escritorio', cc, 'texto', true, 'ponte', '2026-10-05 10:00:00-03');
  insert into public.n8n_chat_histories (session_id, message, created_at) values
    ('whatsapp:escritorio:+5511999990962', '{"type":"human","content":"oi"}'::jsonb, '2026-10-05 09:50:00-03');
  insert into mayara.followup_estado (chave, status, ciclo_saida, etapa_atual, enviados_total, ultimo_envio_em) values
    (cb, 'ativo', '2026-10-05 10:00:00-03', 11, 1, '2026-10-06 10:00:00-03'),
    (cc, 'ativo', '2026-10-05 10:00:00-03', 13, 2, '2026-10-06 10:00:00-03');

  select * into r from mayara.followups_elegiveis('2027-01-15 10:00:00-03') where lead_chave = cb;
  assert r.lead_etapa = 14, 'nunca_respondeu atrasado vai ate a etapa 14, nao alem: ' || coalesce(r.lead_etapa::text, 'nulo');
  select * into r from mayara.followups_elegiveis('2027-01-15 10:00:00-03') where lead_chave = cc;
  assert r.lead_etapa = 14, 'conversa atrasado vai ate a etapa 14: ' || coalesce(r.lead_etapa::text, 'nulo');

  update mayara.followup_estado set etapa_atual = 14, enviados_total = 4 where chave = cb;
  update mayara.followup_estado set etapa_atual = 14, enviados_total = 5 where chave = cc;
  select count(*) into n from mayara.followups_elegiveis('2027-01-15 10:00:00-03') where lead_chave in (cb, cc);
  assert n = 0, 'apos a etapa 14 nao ha mais envio: ' || n;
  select * into f from mayara.followups_fechar_ciclos() where lead_chave = cb;
  assert f.motivo = 'etapas_esgotadas', 'nunca_respondeu fecha por etapas_esgotadas: ' || coalesce(f.motivo, 'nulo');
  assert (select status from mayara.followup_estado where chave = cb) = 'revisao_humana', 'status revisao_humana';
  assert (select status from mayara.followup_estado where chave = cc) = 'revisao_humana', 'conversa tambem fechou';

  update mayara.followup_estado set status = 'ativo', etapa_atual = 6, enviados_total = 14 where chave = cb;
  select * into f from mayara.followups_fechar_ciclos() where lead_chave = cb;
  assert f.motivo = 'teto', 'teto por quantidade continua: ' || coalesce(f.motivo, 'nulo');
end $t$;
rollback;
select 'OK 0064' as resultado;
