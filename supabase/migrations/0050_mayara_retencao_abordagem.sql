-- supabase/migrations/0050_mayara_retencao_abordagem.sql
-- A retencao geral das respostas (respostas_retidas) nao vale para lead ativo com abordagem
-- autorizada pelo administrador e ainda dentro do prazo: o administrador escolheu falar com esse lead.
create or replace function mayara.resposta_permitida_para(p_telefone text, p_agora timestamptz default now())
returns boolean language sql stable set search_path = '' as $$
  select exists (select 1 from mayara.leads_autorizados la
                  where la.telefone_chave = mayara.chave_telefone(p_telefone)
                    and la.status = 'ativo' and la.abordagem_ate > p_agora)
      or (not mayara.respostas_retidas() and mayara.resposta_permitida(p_agora))
$$;

create or replace function mayara.reservar_eventos_adiados(p_agora timestamptz default now(), p_limite integer default 10)
returns table(id bigint, payload jsonb) language plpgsql set search_path = '' as $$
begin
  return query
  with c as (
    select e.id from mayara.eventos_adiados e
     where e.processado_em is null and e.tentativas < 5
       and (exists (select 1 from mayara.leads_autorizados la
                     where la.telefone_chave = e.telefone_chave and la.status = 'ativo' and la.abordagem_ate > p_agora)
            or (not mayara.respostas_retidas() and mayara.resposta_permitida(p_agora)))
     order by e.recebido_em, e.id
     limit greatest(p_limite, 0)
     for update skip locked
  ), u as (
    update mayara.eventos_adiados e
       set processado_em = p_agora, tentativas = e.tentativas + 1
      from c where e.id = c.id
    returning e.id, e.payload, e.recebido_em
  )
  select u.id, u.payload from u order by u.recebido_em, u.id;
end $$;

revoke all on function mayara.resposta_permitida_para(text, timestamptz) from public, anon, authenticated;
revoke all on function mayara.reservar_eventos_adiados(timestamptz, integer) from public, anon, authenticated;
