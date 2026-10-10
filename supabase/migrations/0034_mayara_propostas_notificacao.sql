-- supabase/migrations/0034_mayara_propostas_notificacao.sql
create or replace function mayara.expirar_propostas(p_agora timestamptz default now())
returns integer language plpgsql set search_path = '' as $$
declare v int;
begin
  update mayara.propostas_abordagem
     set estado = 'expirada', encerrada_em = p_agora
   where estado = 'aberta' and expira_em < p_agora;
  get diagnostics v = row_count;
  return v;
end $$;

create or replace function mayara.reservar_notificacoes(p_agora timestamptz default now())
returns table (id bigint, tipo text, nome text, texto text, telefone_fim text)
language plpgsql set search_path = '' as $$
declare
  v_hora int := extract(hour from (p_agora at time zone 'America/Sao_Paulo'))::int;
  v_ja int;
begin
  perform mayara.expirar_propostas(p_agora);
  if v_hora < 6 or v_hora >= 21 then
    return;
  end if;
  select count(*) into v_ja from mayara.propostas_abordagem p
   where p.notificada_em > p_agora - interval '1 hour' and p.notificada_em <= p_agora;
  return query
  with novas as (
    select p.id from mayara.propostas_abordagem p
     where p.estado = 'aberta' and p.notificada_em is null
     order by p.criado_em, p.id
     limit greatest(10 - v_ja, 0)
  ), marcadas as (
    update mayara.propostas_abordagem p set notificada_em = p_agora
     where p.id in (select novas.id from novas)
     returning p.id, p.nome, p.texto, p.telefone_chave
  ), lembretes as (
    update mayara.propostas_abordagem p set lembrete_em = p_agora
     where p.estado = 'aberta' and p.notificada_em is not null and p.lembrete_em is null
       and p.notificada_em < p_agora - interval '30 minutes'
       and p.id not in (select novas.id from novas)
     returning p.id, p.nome, p.texto, p.telefone_chave
  )
  select m.id, 'nova'::text, m.nome, m.texto, right(m.telefone_chave, 4) from marcadas m
  union all
  select l.id, 'lembrete'::text, l.nome, l.texto, right(l.telefone_chave, 4) from lembretes l;
end $$;

revoke all on function mayara.expirar_propostas(timestamptz) from public, anon, authenticated;
revoke all on function mayara.reservar_notificacoes(timestamptz) from public, anon, authenticated;
