-- Funcoes de leitura da tela inicial do painel (somente leitura, sem texto de conversa).
-- Atividade dos leads vem do canal (canal_eventos = chegada, inclusive o que ficou retido; envios_log = saidas da Mayara).
-- O historico do n8n grava a mensagem do lead junto com a resposta, entao so serve para as mensagens da equipe.

create or replace function painel._mensagens()
returns table(chave text, id integer, quando timestamptz, papel text)
language sql stable set search_path = '' as $$
  select mayara.chave_telefone(substring(h.session_id from '[+0-9]+$')), h.id, h.created_at,
         case
           when h.message ->> 'type' = 'human' then 'lead'
           when h.message ->> 'type' = 'ai' and coalesce(h.message ->> 'content', '') like 'Mensagem enviada por uma pessoa do escritório%' then 'equipe'
           when h.message ->> 'type' = 'ai' and coalesce(h.message ->> 'content', '') not in ('', '[]')
                and h.message ->> 'content' not like 'Nota do sistema%' then 'mayara'
         end
    from public.n8n_chat_histories h
$$;

create or replace function painel._entradas()
returns table(chave text, quando timestamptz)
language sql stable set search_path = '' as $$
  select e.remetente_chave, e.criado_em
    from mayara.canal_eventos e
   where e.resultado = 'aceito'
     and exists (select 1 from mayara.leads_autorizados la where la.telefone_chave = e.remetente_chave)
$$;

create or replace function painel.faixa_numeros(p_de timestamptz, p_ate timestamptz)
returns jsonb language sql stable set search_path = '' as $$
  with ent as (select * from painel._entradas()),
       primeira as (
         select l.destino_chave as chave, min(l.criado_em) as t
           from mayara.envios_log l
          where l.ok and exists (select 1 from mayara.leads_autorizados la where la.telefone_chave = l.destino_chave)
          group by l.destino_chave)
  select jsonb_build_object(
    'leads_novos', (select count(*) from crm_sync.leads l where l.created_at >= p_de and l.created_at < p_ate),
    'em_conversa', (select count(distinct chave) from ent where quando >= p_de and quando < p_ate),
    'sem_resposta', (select count(*) from primeira p
                      where p.t >= p_de and p.t < p_ate and p.chave not in (select chave from ent)),
    'followups', (select count(*) from mayara.followups_log f
                   where f.estado = 'enviado' and f.atualizado_em >= p_de and f.atualizado_em < p_ate),
    'consultas', (select count(distinct mayara.chave_telefone(s.phone)) from mayara.session_state s
                   where s.consulta_agendada_em >= p_de and s.consulta_agendada_em < p_ate),
    'canal', coalesce((select estado from mayara.canal_estado where canal_id = 'escritorio'), 'desconhecido')
  )
$$;

create or replace function painel.leads_por_etapa()
returns table(etapa text, quantidade integer)
language sql stable set search_path = '' as $$
  with lista as (select la.telefone_chave as chave, la.status from mayara.leads_autorizados la),
       sess as (
         select mayara.chave_telefone(s.phone) as chave,
                bool_or(s.consulta_agendada_em is not null) as consulta,
                bool_or(s.estado = 'S7_HANDOFF_HUMANO') as handoff
           from mayara.session_state s group by 1),
       respondeu as (select distinct chave from painel._entradas()),
       classe as (
         select case
                  when l.status = 'sem_interesse' then 'Perdidos'
                  when coalesce(s.consulta, false) then 'Consulta'
                  when l.status = 'bloqueado' or coalesce(s.handoff, false) then 'Com a equipe'
                  when r.chave is not null then 'Em conversa'
                  else 'Novo'
                end as etapa
           from lista l
           left join sess s on s.chave = l.chave
           left join respondeu r on r.chave = l.chave)
  select e.etapa, coalesce((select count(*) from classe c where c.etapa = e.etapa), 0)::integer
    from (values (1, 'Novo'), (2, 'Em conversa'), (3, 'Consulta'), (4, 'Com a equipe'), (5, 'Contrato'), (6, 'Perdidos')) e(ordem, etapa)
   order by e.ordem
$$;

create or replace function painel.followups_periodo(p_de timestamptz, p_ate timestamptz)
returns table(enviados integer, respostas integer, falhas integer)
language sql stable set search_path = '' as $$
  select (select count(*) from mayara.followups_log f
           where f.estado = 'enviado' and f.atualizado_em >= p_de and f.atualizado_em < p_ate)::integer,
         (select count(distinct f.chave) from mayara.followups_log f
           where f.estado = 'enviado' and f.atualizado_em >= p_de and f.atualizado_em < p_ate
             and exists (select 1 from painel._entradas() en where en.chave = f.chave and en.quando > f.atualizado_em))::integer,
         (select count(*) from mayara.followups_log f
           where f.estado = 'falhou' and f.atualizado_em >= p_de and f.atualizado_em < p_ate)::integer
$$;

-- Fonte: campanha do fatos_json da sessao, depois a coluna campaign do CRM, depois "sem origem".
create or replace function painel.fontes_de_lead(p_de timestamptz, p_ate timestamptz)
returns table(fonte text, quantidade integer)
language sql stable set search_path = '' as $$
  select coalesce(nullif(btrim(s.fatos_json ->> 'campanha'), ''), nullif(btrim(l.campaign), ''), 'sem origem') as fonte,
         count(*)::integer as quantidade
    from crm_sync.leads l
    left join lateral (
      select x.fatos_json from mayara.session_state x
       where mayara.chave_telefone(x.phone) = mayara.chave_telefone(l.phone)
       order by x.updated_at desc limit 1) s on true
   where l.created_at >= p_de and l.created_at < p_ate
   group by 1
   order by 2 desc, 1
$$;

-- Tempo de resposta da Mayara: da chegada da mensagem do lead (canal) ate a resposta seguinte da Mayara (envios_log, origem 'ponte').
-- Pares com mais de 24 h ficam de fora (respostas seguradas pela retencao distorceriam a media).
create or replace function painel.tempo_resposta(p_de timestamptz, p_ate timestamptz)
returns table(media_segundos integer, maior_espera_segundos integer)
language sql stable set search_path = '' as $$
  with m as (
    select chave, quando, 'l'::text as k from painel._entradas()
    union all
    select l.destino_chave, l.criado_em, 'm'::text
      from mayara.envios_log l
     where l.ok and l.origem = 'ponte'
       and exists (select 1 from mayara.leads_autorizados la where la.telefone_chave = l.destino_chave)),
  m2 as (
    select *, coalesce(sum((k = 'm')::int) over (
               partition by chave order by quando, k rows between unbounded preceding and 1 preceding), 0) as ciclo
      from m),
  pares as (
    select chave, ciclo, min(quando) filter (where k = 'l') as t0, min(quando) filter (where k = 'm') as t1
      from m2 group by chave, ciclo),
  validos as (
    select extract(epoch from (t1 - t0)) as seg from pares
     where t0 is not null and t1 is not null and t1 > t0 and t0 >= p_de and t0 < p_ate
       and t1 - t0 <= interval '24 hours'),
  ult_entrada as (select chave, max(quando) as t from painel._entradas() group by chave),
  ult_saida as (
    select chave, max(t) as t from (
      select l.destino_chave as chave, l.criado_em as t from mayara.envios_log l where l.ok
      union all
      select chave, quando from painel._mensagens() where papel = 'equipe') x
     group by chave),
  espera as (
    select extract(epoch from (now() - u.t)) as seg
      from ult_entrada u
      join mayara.leads_autorizados la on la.telefone_chave = u.chave
      left join ult_saida s on s.chave = u.chave
      left join (select mayara.chave_telefone(x.phone) as chave, bool_or(x.estado = 'S7_HANDOFF_HUMANO') as handoff
                   from mayara.session_state x group by 1) h on h.chave = u.chave
     where (la.status = 'bloqueado' or coalesce(h.handoff, false))
       and u.t > coalesce(s.t, '-infinity'::timestamptz))
  select (select round(avg(seg))::integer from validos),
         (select round(max(seg))::integer from espera)
$$;

revoke all on function painel._mensagens() from public, anon, authenticated;
revoke all on function painel._entradas() from public, anon, authenticated;
revoke all on function painel.faixa_numeros(timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function painel.leads_por_etapa() from public, anon, authenticated;
revoke all on function painel.followups_periodo(timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function painel.fontes_de_lead(timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function painel.tempo_resposta(timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function painel._mensagens(), painel._entradas(), painel.faixa_numeros(timestamptz, timestamptz), painel.leads_por_etapa(),
  painel.followups_periodo(timestamptz, timestamptz), painel.fontes_de_lead(timestamptz, timestamptz),
  painel.tempo_resposta(timestamptz, timestamptz) to painel_leitura;
