-- supabase/migrations/0048_mayara_respostas_retidas.sql
-- Retencao geral: com a chave ligada, nenhuma mensagem de lead e respondida automaticamente.
-- Os eventos ficam guardados em mayara.eventos_adiados ate a chave voltar a 'false'.
insert into mayara.config (chave, valor) values ('respostas_retidas', 'false') on conflict (chave) do nothing;

create or replace function mayara.respostas_retidas()
returns boolean language sql stable set search_path = '' as $$
  select coalesce((select valor from mayara.config where chave = 'respostas_retidas'), 'false') = 'true'
$$;

create or replace function mayara.resposta_permitida_para(p_telefone text, p_agora timestamptz default now())
returns boolean language sql stable set search_path = '' as $$
  select not mayara.respostas_retidas()
     and (mayara.resposta_permitida(p_agora)
          or exists (select 1 from mayara.leads_autorizados la
                      where la.telefone_chave = mayara.chave_telefone(p_telefone)
                        and la.status = 'ativo' and la.abordagem_ate > p_agora))
$$;

create or replace function mayara.reservar_eventos_adiados(p_agora timestamptz default now(), p_limite integer default 10)
returns table(id bigint, payload jsonb) language plpgsql set search_path = '' as $$
begin
  if mayara.respostas_retidas() then
    return;
  end if;
  return query
  with c as (
    select e.id from mayara.eventos_adiados e
     where e.processado_em is null and e.tentativas < 5
       and (mayara.resposta_permitida(p_agora)
            or exists (select 1 from mayara.leads_autorizados la
                        where la.telefone_chave = e.telefone_chave and la.status = 'ativo' and la.abordagem_ate > p_agora))
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

revoke all on function mayara.respostas_retidas() from public, anon, authenticated;
revoke all on function mayara.resposta_permitida_para(text, timestamptz) from public, anon, authenticated;
revoke all on function mayara.reservar_eventos_adiados(timestamptz, integer) from public, anon, authenticated;
