-- supabase/migrations/0031_mayara_central_consultas.sql
create or replace function mayara._numero_na_frase(p_texto text)
returns int language sql immutable set search_path = '' as $$
  select coalesce((regexp_match(p_texto, '([0-9]+)'))[1]::int, 0)
$$;

create or replace function mayara.contagem_leads(p_periodo text)
returns text language plpgsql stable set search_path = '' as $$
declare
  v_desde timestamptz;
  v_rotulo text;
  v_total int;
  v_novos int;
begin
  case lower(btrim(coalesce(p_periodo, '')))
    when 'hoje' then
      v_desde := date_trunc('day', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo';
      v_rotulo := 'hoje';
    when 'semana' then
      v_desde := (date_trunc('day', now() at time zone 'America/Sao_Paulo') - interval '6 days') at time zone 'America/Sao_Paulo';
      v_rotulo := 'nos últimos 7 dias';
    when 'mes' then
      v_desde := (date_trunc('day', now() at time zone 'America/Sao_Paulo') - interval '29 days') at time zone 'America/Sao_Paulo';
      v_rotulo := 'nos últimos 30 dias';
    else
      return 'Não reconheci o período. Use hoje, semana ou mês.';
  end case;
  select count(*), count(*) filter (where status = 'New') into v_total, v_novos
    from crm_sync.leads where created_at >= v_desde;
  return v_total::text || ' leads recebidos ' || v_rotulo || ' (' || v_novos::text || ' ainda sem atendimento no CRM).';
end $$;

create or replace function mayara.situacao_lead(p_telefone text)
returns text language plpgsql stable set search_path = '' as $$
declare
  v_chave text := mayara.chave_telefone(p_telefone);
  l mayara.leads_autorizados%rowtype;
  s mayara.session_state%rowtype;
  v_crm text;
begin
  if v_chave is null then
    return 'Número inválido. Use o formato +5514999990000 (com DDD).';
  end if;
  select * into l from mayara.leads_autorizados where telefone_chave = v_chave;
  if not found then
    return 'Esse número não está na lista de leads da Mayara.';
  end if;
  select * into s from mayara.session_state where mayara.chave_telefone(phone) = v_chave order by last_lead_message_at desc nulls last limit 1;
  if l.espocrm_lead_id is not null then
    select status into v_crm from crm_sync.leads where id = l.espocrm_lead_id;
  end if;
  return coalesce(l.nome, 'Lead') || ' (final ' || right(v_chave, 4) || E')\n'
    || 'Mayara: ' || l.status || E'\n'
    || 'Conversa: ' || coalesce(s.estado, 'sem conversa') || E'\n'
    || 'Última mensagem do lead: ' || coalesce(to_char(s.last_lead_message_at at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI'), 'nenhuma') || E'\n'
    || 'Consulta: ' || coalesce(to_char(s.consulta_agendada_em at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI'), 'não agendada') || E'\n'
    || 'CRM: ' || coalesce(v_crm, 'sem registro vinculado');
end $$;

revoke all on function mayara._numero_na_frase(text) from public, anon, authenticated;
revoke all on function mayara.contagem_leads(text) from public, anon, authenticated;
revoke all on function mayara.situacao_lead(text) from public, anon, authenticated;
