-- Rodar inteiro (execute_sql). Periodo no futuro (2030) para nao colidir com dados reais; termina em rollback.
begin;
do $t$
declare
  de timestamptz := timestamptz '2030-03-01 00:00:00-03';
  ate timestamptz := timestamptz '2030-03-08 00:00:00-03';
  j jsonb; antes jsonb; depois jsonb; n_depois int; r record; canal_real text;
  ca text := mayara.chave_telefone('+5511999991101'); cb text := mayara.chave_telefone('+5511999991102');
  cc text := mayara.chave_telefone('+5511999991103'); ch text := mayara.chave_telefone('+5511999991108');
  ci text := mayara.chave_telefone('+5511999991109'); cg text := mayara.chave_telefone('+5511999991107');
begin
  select estado into canal_real from mayara.canal_estado where canal_id = 'escritorio';
  select coalesce(jsonb_object_agg(etapa, quantidade), '{}'::jsonb) into antes from painel.leads_por_etapa();

  insert into mayara.leads_autorizados (telefone, nome, status) values
    ('+5511999991101', 'Num A', 'ativo'), ('+5511999991102', 'Num B', 'ativo'), ('+5511999991103', 'Num C', 'ativo'),
    ('+5511999991104', 'Num D', 'ativo'), ('+5511999991105', 'Num E', 'bloqueado'), ('+5511999991106', 'Num F', 'sem_interesse'),
    ('+5511999991107', 'Num G', 'ativo'), ('+5511999991108', 'Num H', 'ativo'), ('+5511999991109', 'Num I', 'ativo');

  insert into mayara.session_state (session_key, phone, estado, fatos_json) values
    ('whatsapp:escritorio:+5511999991101', '+5511999991101', 'S2_QUALIFICACAO', '{"campanha":"Camp Fatos"}'),
    ('whatsapp:escritorio:+551199991101', '+551199991101', 'S2_QUALIFICACAO', '{}');
  insert into mayara.session_state (session_key, phone, estado, consulta_agendada_em) values
    ('whatsapp:escritorio:+5511999991104', '+5511999991104', 'S6_AGENDADO', timestamptz '2030-03-05 15:00:00-03');
  insert into mayara.session_state (session_key, phone, estado) values
    ('whatsapp:escritorio:+5511999991107', '+5511999991107', 'S7_HANDOFF_HUMANO');

  insert into mayara.canal_eventos (canal_id, provedor, resultado, remetente_chave, tipo, criado_em) values
    ('escritorio', 'evolution', 'aceito', ca, 'text', timestamptz '2030-03-02 10:05:00-03'),
    ('escritorio', 'evolution', 'aceito', ca, 'text', timestamptz '2030-03-03 12:00:00-03'),
    ('escritorio', 'evolution', 'aceito', cc, 'text', timestamptz '2030-03-04 09:00:00-03'),
    ('escritorio', 'evolution', 'aceito', ch, 'text', timestamptz '2030-03-01 00:00:00-03'),
    ('escritorio', 'evolution', 'aceito', ci, 'text', timestamptz '2030-03-08 00:00:00-03'),
    ('escritorio', 'evolution', 'aceito', cg, 'text', now() - interval '2 hours'),
    ('escritorio', 'evolution', 'aceito', mayara.chave_telefone('+5511999991199'), 'text', timestamptz '2030-03-02 11:00:00-03'),
    ('escritorio', 'evolution', 'descartado', cb, 'text', timestamptz '2030-03-02 11:00:00-03');

  insert into mayara.envios_log (canal_id, destino_chave, tipo, ok, provedor_message_id, origem, criado_em) values
    ('escritorio', ca, 'texto', true, 'PN1', 'abordagem_automatica', timestamptz '2030-03-02 10:00:00-03'),
    ('escritorio', ca, 'texto', true, 'PN2', 'ponte', timestamptz '2030-03-02 10:06:00-03'),
    ('escritorio', ca, 'texto', true, 'PN3', 'ponte', timestamptz '2030-03-03 12:03:00-03'),
    ('escritorio', cb, 'texto', true, 'PN4', 'abordagem_assistida', timestamptz '2030-03-03 09:00:00-03'),
    ('escritorio', cc, 'texto', true, 'PN5', 'abordagem_assistida', timestamptz '2030-02-20 09:00:00-03'),
    ('escritorio', cc, 'texto', true, 'PN6', 'ponte', timestamptz '2030-03-04 09:00:30-03'),
    ('escritorio', ca, 'texto', true, 'PN7', 'followup', timestamptz '2030-03-03 11:00:00-03');
  insert into public.n8n_chat_histories (session_id, message, created_at) values
    ('whatsapp:escritorio:+5511999991101', '{"type":"ai","content":"Mensagem enviada por uma pessoa do escritório em 03/03: oi"}', timestamptz '2030-03-03 12:02:00-03');

  insert into crm_sync.leads (id, name, status, created_at, modified_at, phone, campaign) values
    ('t-1101', 'Crm A', 'New', timestamptz '2030-03-02 09:00:00-03', timestamptz '2030-03-02 09:00:00-03', '+5511999991101', null),
    ('t-1102', 'Crm B', 'New', timestamptz '2030-03-03 08:00:00-03', timestamptz '2030-03-03 08:00:00-03', '+5511999991102', 'Camp CRM'),
    ('t-1103', 'Crm C', 'New', timestamptz '2030-03-04 08:00:00-03', timestamptz '2030-03-04 08:00:00-03', '+5511999991103', null),
    ('t-1190', 'Crm fora', 'New', timestamptz '2030-02-27 08:00:00-03', timestamptz '2030-02-27 08:00:00-03', '+5511999991190', 'Camp Fora');

  insert into mayara.followups_log (chave, sequencia, etapa, estado, ciclo_saida, criado_em, atualizado_em) values
    (ca, 'conversa', 4, 'enviado', timestamptz '2030-03-02 10:06:00-03', timestamptz '2030-03-03 11:00:00-03', timestamptz '2030-03-03 11:00:00-03'),
    (cb, 'nunca_respondeu', 4, 'enviado', timestamptz '2030-03-03 09:00:00-03', timestamptz '2030-03-04 11:00:00-03', timestamptz '2030-03-04 11:00:00-03'),
    (cb, 'nunca_respondeu', 5, 'falhou', timestamptz '2030-03-03 09:00:00-03', timestamptz '2030-03-05 11:00:00-03', timestamptz '2030-03-05 11:00:00-03'),
    (cc, 'conversa', 4, 'enviado', timestamptz '2030-02-01 10:00:00-03', timestamptz '2030-02-10 11:00:00-03', timestamptz '2030-02-10 11:00:00-03');

  j := painel.faixa_numeros(de, ate);
  assert (j ->> 'leads_novos')::int = 3, 'leads_novos: ' || j::text;
  assert (j ->> 'em_conversa')::int = 3, 'em_conversa: ' || j::text;
  assert (j ->> 'sem_resposta')::int = 1, 'sem_resposta: ' || j::text;
  assert (j ->> 'followups')::int = 2, 'followups: ' || j::text;
  assert (j ->> 'consultas')::int = 1, 'consultas: ' || j::text;
  assert (j ->> 'canal') = coalesce(canal_real, 'desconhecido'), 'canal: ' || j::text;

  select * into r from painel.followups_periodo(de, ate);
  assert r.enviados = 2 and r.respostas = 1 and r.falhas = 1, 'followups_periodo: ' || r::text;

  assert (select quantidade from painel.fontes_de_lead(de, ate) where fonte = 'Camp Fatos') = 1, 'fonte vinda do fatos_json';
  assert (select quantidade from painel.fontes_de_lead(de, ate) where fonte = 'Camp CRM') = 1, 'fonte vinda da coluna do CRM';
  assert (select quantidade from painel.fontes_de_lead(de, ate) where fonte = 'sem origem') = 1, 'sem origem';
  assert not exists (select 1 from painel.fontes_de_lead(de, ate) where fonte = 'Camp Fora'), 'lead fora do periodo nao conta';

  select * into r from painel.tempo_resposta(de, ate);
  assert r.media_segundos = 90, 'media_segundos: ' || coalesce(r.media_segundos::text, 'nulo');
  assert r.maior_espera_segundos >= 7000, 'maior espera: ' || coalesce(r.maior_espera_segundos::text, 'nulo');

  select jsonb_object_agg(etapa, quantidade) into depois from painel.leads_por_etapa();
  assert (depois ->> 'Novo')::int - coalesce((antes ->> 'Novo')::int, 0) = 1, 'Novo +1 (B)';
  assert (depois ->> 'Em conversa')::int - coalesce((antes ->> 'Em conversa')::int, 0) = 4, 'Em conversa +4 (A, C, H, I)';
  assert (depois ->> 'Consulta')::int - coalesce((antes ->> 'Consulta')::int, 0) = 1, 'Consulta +1 (D)';
  assert (depois ->> 'Com a equipe')::int - coalesce((antes ->> 'Com a equipe')::int, 0) = 2, 'Com a equipe +2 (E e G)';
  assert (depois ->> 'Contrato')::int - coalesce((antes ->> 'Contrato')::int, 0) = 0, 'Contrato +0';
  assert (depois ->> 'Perdidos')::int - coalesce((antes ->> 'Perdidos')::int, 0) = 1, 'Perdidos +1 (F)';
  select count(*) into n_depois from mayara.leads_autorizados;
  assert (select sum(quantidade) from painel.leads_por_etapa()) = n_depois, 'a soma das etapas e o total de leads da lista';
  assert (select count(*) from painel.leads_por_etapa()) = 6, 'seis linhas, sempre';

  assert not has_function_privilege('anon', 'painel.faixa_numeros(timestamptz, timestamptz)', 'execute'), 'anon sem execute faixa_numeros';
  assert not has_function_privilege('authenticated', 'painel.leads_por_etapa()', 'execute'), 'authenticated sem execute leads_por_etapa';
end $t$;
rollback;
select 'OK 0066' as resultado;
