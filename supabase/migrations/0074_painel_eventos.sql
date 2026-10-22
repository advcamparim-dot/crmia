-- Historico de eventos por lead (so de acrescimo), reconstruido do que as tabelas atuais guardam e mantido em dia
-- por painel.eventos_atualizar(). Datas de consulta_marcada, transferido_equipe e perdido sao aproximadas (detalhe.aprox).
create table if not exists painel.eventos (
  id bigserial primary key,
  lead_chave text not null,
  tipo text not null check (tipo in ('lead_criado', 'primeira_mensagem', 'lead_respondeu', 'followup_enviado',
                                      'consulta_marcada', 'transferido_equipe', 'perdido', 'contrato_fechado')),
  ocorrido_em timestamptz not null,
  ref text not null default 'unico',
  detalhe jsonb not null default '{}'::jsonb,
  criado_em timestamptz not null default now(),
  unique (lead_chave, tipo, ref)
);
create index if not exists eventos_tipo_data_idx on painel.eventos (tipo, ocorrido_em);
alter table painel.eventos enable row level security;
revoke all on painel.eventos from public, anon, authenticated;

create or replace function painel.eventos_atualizar()
returns integer language plpgsql set search_path = '' as $$
declare v_total integer := 0; v_n integer;
begin
  -- lead criado no CRM (inclui leads fora da lista)
  insert into painel.eventos (lead_chave, tipo, ocorrido_em)
  select mayara.chave_telefone(l.phone), 'lead_criado', min(l.created_at)
    from crm_sync.leads l where mayara.chave_telefone(l.phone) is not null
   group by 1
  on conflict (lead_chave, tipo, ref) do nothing;
  get diagnostics v_n = row_count; v_total := v_total + v_n;

  -- primeira mensagem da Mayara ao lead
  insert into painel.eventos (lead_chave, tipo, ocorrido_em)
  select e.destino_chave, 'primeira_mensagem', min(e.criado_em)
    from mayara.envios_log e
   where e.ok and e.origem in ('ponte', 'abordagem_assistida', 'abordagem_automatica', 'reativacao')
     and exists (select 1 from mayara.leads_autorizados la where la.telefone_chave = e.destino_chave)
   group by 1
  on conflict (lead_chave, tipo, ref) do nothing;
  get diagnostics v_n = row_count; v_total := v_total + v_n;

  -- primeira resposta do lead
  insert into painel.eventos (lead_chave, tipo, ocorrido_em)
  select x.chave, 'lead_respondeu', min(x.quando) from painel._entradas() x group by 1
  on conflict (lead_chave, tipo, ref) do nothing;
  get diagnostics v_n = row_count; v_total := v_total + v_n;

  -- cada follow-up enviado
  insert into painel.eventos (lead_chave, tipo, ocorrido_em, ref, detalhe)
  select f.chave, 'followup_enviado', f.criado_em, 'f' || f.id, jsonb_build_object('etapa', f.etapa, 'sequencia', f.sequencia)
    from mayara.followups_log f where f.estado = 'enviado'
  on conflict (lead_chave, tipo, ref) do nothing;
  get diagnostics v_n = row_count; v_total := v_total + v_n;

  -- consulta marcada
  insert into painel.eventos (lead_chave, tipo, ocorrido_em, detalhe)
  select mayara.chave_telefone(s.phone), 'consulta_marcada', min(least(s.updated_at, now())),
         jsonb_build_object('aprox', true, 'horario', max(s.consulta_agendada_em))
    from mayara.session_state s
   where s.consulta_agendada_em is not null and mayara.chave_telefone(s.phone) is not null
   group by 1
  on conflict (lead_chave, tipo, ref) do nothing;
  get diagnostics v_n = row_count; v_total := v_total + v_n;

  -- transferido para a equipe (sessao em handoff ou lead assumido)
  insert into painel.eventos (lead_chave, tipo, ocorrido_em, detalhe)
  select c.chave, 'transferido_equipe', min(c.quando), jsonb_build_object('aprox', true)
    from (
      select mayara.chave_telefone(s.phone) as chave, s.updated_at as quando
        from mayara.session_state s where s.estado = 'S7_HANDOFF_HUMANO'
      union all
      select la.telefone_chave, la.atualizado_em from mayara.leads_autorizados la where la.status = 'bloqueado'
    ) c where c.chave is not null group by 1
  on conflict (lead_chave, tipo, ref) do nothing;
  get diagnostics v_n = row_count; v_total := v_total + v_n;

  -- perdido (sem interesse)
  insert into painel.eventos (lead_chave, tipo, ocorrido_em, detalhe)
  select la.telefone_chave, 'perdido', la.atualizado_em, jsonb_build_object('aprox', true)
    from mayara.leads_autorizados la where la.status = 'sem_interesse'
  on conflict (lead_chave, tipo, ref) do nothing;
  get diagnostics v_n = row_count; v_total := v_total + v_n;

  return v_total;
end $$;

revoke all on function painel.eventos_atualizar() from public, anon, authenticated;
grant execute on function painel.eventos_atualizar() to painel_leitura;
