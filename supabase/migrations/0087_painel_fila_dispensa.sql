-- "Ja assumi": o dono dispensa um lead da fila "Precisa de voce". O item volta sozinho se o lead escrever de novo.
create table if not exists painel.fila_dispensas (
  chave text primary key,
  dispensado_em timestamptz not null default now(),
  quem text not null default 'painel'
);
alter table painel.fila_dispensas enable row level security;
revoke all on painel.fila_dispensas from public, anon, authenticated;

create or replace function painel.fila_dispensar(p_telefone text, p_quem text default 'painel')
returns boolean language plpgsql set search_path = '' as $$
declare v_chave text := mayara.chave_telefone(p_telefone);
begin
  if v_chave is null or not exists (select 1 from mayara.leads_autorizados la where la.telefone_chave = v_chave) then
    return false;
  end if;
  insert into painel.fila_dispensas (chave, dispensado_em, quem) values (v_chave, now(), coalesce(nullif(p_quem, ''), 'painel'))
  on conflict (chave) do update set dispensado_em = now(), quem = excluded.quem;
  return true;
end $$;

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
       disp as (select chave, dispensado_em as t from painel.fila_dispensas),
       t1 as (
         select l.*, en.t as desde
           from lista l
           join ent en on en.chave = l.chave
           left join sess ss on ss.chave = l.chave
           left join saida sd on sd.chave = l.chave
           left join equipe eq on eq.chave = l.chave
           left join disp dp on dp.chave = l.chave
          where l.status <> 'sem_interesse'
            and (l.status = 'bloqueado' or coalesce(ss.handoff, false))
            and en.t > greatest(coalesce(sd.t, '-infinity'::timestamptz), coalesce(eq.t, '-infinity'::timestamptz), coalesce(dp.t, '-infinity'::timestamptz))),
       t2 as (
         select l.*, ss.t_handoff as desde
           from lista l
           join sess ss on ss.chave = l.chave
           left join equipe eq on eq.chave = l.chave
           left join disp dp on dp.chave = l.chave
          where l.status <> 'sem_interesse'
            and ss.handoff
            and not (coalesce(eq.t, '-infinity'::timestamptz) > ss.t_handoff)
            and not (coalesce(dp.t, '-infinity'::timestamptz) >= ss.t_handoff)
            and l.chave not in (select chave from t1)),
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
       t5 as (
         select c.lead_chave as chave, max(c.lead_nome) as nome, max(c.telefone) as telefone, max(c.crm_lead_id) as crm_id,
                (min(p.vencimento)::timestamp at time zone 'America/Sao_Paulo') as desde,
                count(*) as qtd, sum(p.valor) as total, painel._hoje() - min(p.vencimento) as dias
           from painel.parcelas p join painel.contratos c on c.id = p.contrato_id
          where p.pago_em is null and p.vencimento < painel._hoje()
          group by c.lead_chave),
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
      union all select 'parcela_atrasada', 5, chave, nome, telefone, crm_id, desde,
                       case when qtd = 1 then mayara._brl((total * 100)::bigint) || ' em atraso há ' || dias || (case when dias = 1 then ' dia' else ' dias' end)
                            else qtd || ' parcelas somando ' || mayara._brl((total * 100)::bigint) || ', a mais antiga há ' || dias || ' dias' end from t5
      union all select 'fim_sequencia', 6, chave, nome, telefone, crm_id, desde, 'Sequencia de follow-up chegou ao fim ou ao teto' from t6
      union all select 'canal', 7, null, null, null, null, desde,
                       'WhatsApp ' || case estado when 'close' then 'desconectado' else estado end from t7
    ) x
   order by x.urgencia, x.desde
$$;

revoke all on function painel.fila_dispensar(text, text), painel.fila_atencao() from public, anon, authenticated;
grant execute on function painel.fila_dispensar(text, text), painel.fila_atencao() to painel_leitura;
