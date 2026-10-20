-- Fila "Precisa de voce": uma linha por situacao em aberto, do mais urgente para o menos. Nenhuma coluna traz texto de conversa.
-- Tipos: lead_esperando (1), transferencia (2), agendamento_falhou (3), consulta_24h (4), parcela_atrasada (5, etapa 3),
-- fim_sequencia (6), canal (7). Cada item some quando a situacao se resolve.
create or replace function painel.fila_atencao()
returns table(tipo text, urgencia integer, lead_nome text, telefone_fim text, telefone text, crm_lead_id text, desde timestamptz, detalhe text)
language sql stable set search_path = '' as $$
  with lista as (
         select la.telefone_chave as chave, la.nome, la.telefone, la.espocrm_lead_id as crm_id, la.status from mayara.leads_autorizados la),
       ent as (select chave, max(quando) as t from painel._entradas() group by chave),
       equipe as (select chave, max(quando) as t from painel._mensagens() where papel = 'equipe' group by chave),
       saida as (select l.destino_chave as chave, max(l.criado_em) as t from mayara.envios_log l where l.ok group by l.destino_chave),
       sess as (
         select mayara.chave_telefone(s.phone) as chave,
                bool_or(s.estado = 'S7_HANDOFF_HUMANO') as handoff,
                max(s.updated_at) filter (where s.estado = 'S7_HANDOFF_HUMANO') as t_handoff,
                max(s.consulta_agendada_em) as consulta
           from mayara.session_state s group by 1),
       -- tipo 1: lead da equipe (assumido ou transferido) que escreveu depois da ultima saida (da Mayara, do sistema ou da equipe)
       t1 as (
         select l.*, en.t as desde
           from lista l
           join ent en on en.chave = l.chave
           left join sess ss on ss.chave = l.chave
           left join saida sd on sd.chave = l.chave
           left join equipe eq on eq.chave = l.chave
          where l.status <> 'sem_interesse'
            and (l.status = 'bloqueado' or coalesce(ss.handoff, false))
            and en.t > greatest(coalesce(sd.t, '-infinity'::timestamptz), coalesce(eq.t, '-infinity'::timestamptz))),
       -- tipo 2: conversa passada para a equipe e ainda sem mensagem humana depois (so a equipe resolve; a fala automatica de aviso nao)
       t2 as (
         select l.*, ss.t_handoff as desde
           from lista l
           join sess ss on ss.chave = l.chave
           left join equipe eq on eq.chave = l.chave
          where l.status <> 'sem_interesse'
            and ss.handoff
            and not (coalesce(eq.t, '-infinity'::timestamptz) > ss.t_handoff)
            and l.chave not in (select chave from t1)),
       -- tipo 3: falha de agendamento aberta; resolve quando a equipe escreve ao lead ou uma consulta e marcada depois
       t3 as (
         select distinct on (f.telefone_chave) f.telefone_chave as chave, l.nome, l.telefone, l.crm_id, f.criada_em as desde
           from painel.falhas_agendamento f
           left join lista l on l.chave = f.telefone_chave
           left join equipe eq on eq.chave = f.telefone_chave
           left join sess ss on ss.chave = f.telefone_chave
          where f.resolvida_em is null
            and not (coalesce(eq.t, '-infinity'::timestamptz) > f.criada_em)
            and not (coalesce(ss.consulta, '-infinity'::timestamptz) > f.criada_em)
          order by f.telefone_chave, f.criada_em desc),
       t4 as (
         select l.*, ss.consulta as desde
           from lista l join sess ss on ss.chave = l.chave
          where ss.consulta >= now() and ss.consulta < now() + interval '24 hours'),
       t6 as (
         select l.*, fe.atualizado_em as desde
           from lista l join mayara.followup_estado fe on fe.chave = l.chave
          where fe.status = 'revisao_humana'),
       t7 as (
         select ce.estado, coalesce(ce.queda_desde, ce.atualizado_em) as desde
           from mayara.canal_estado ce where ce.canal_id = 'escritorio' and ce.estado <> 'open')
  select x.tipo, x.urgencia, x.nome, right(x.chave, 4), x.telefone, x.crm_id, x.desde, x.detalhe
    from (
      select 'lead_esperando' as tipo, 1 as urgencia, chave, nome, telefone, crm_id, desde, 'Aguardando resposta da equipe' as detalhe from t1
      union all select 'transferencia', 2, chave, nome, telefone, crm_id, desde, 'A Mayara passou a conversa para a equipe' from t2
      union all select 'agendamento_falhou', 3, chave, nome, telefone, crm_id, desde, 'Confirmar a consulta manualmente' from t3
      union all select 'consulta_24h', 4, chave, nome, telefone, crm_id, desde,
                       'Consulta em ' || to_char(desde at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI') from t4
      union all select 'fim_sequencia', 6, chave, nome, telefone, crm_id, desde, 'Sequencia de follow-up chegou ao fim ou ao teto' from t6
      union all select 'canal', 7, null, null, null, null, desde,
                       'WhatsApp ' || case estado when 'close' then 'desconectado' else estado end from t7
    ) x
   order by x.urgencia, x.desde
$$;

revoke all on function painel.fila_atencao() from public, anon, authenticated;
grant execute on function painel.fila_atencao() to painel_leitura;
