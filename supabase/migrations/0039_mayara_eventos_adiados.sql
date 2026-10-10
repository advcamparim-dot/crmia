-- Mensagens de lead recebidas fora do expediente: guardadas e reenviadas na abertura seguinte.
create table mayara.eventos_adiados (
  id bigserial primary key,
  telefone_chave text,
  payload jsonb not null,
  recebido_em timestamptz not null default now(),
  processado_em timestamptz,
  tentativas int not null default 0,
  erro text
);
create index eventos_adiados_pendentes on mayara.eventos_adiados (recebido_em, id) where processado_em is null;
alter table mayara.eventos_adiados enable row level security;
revoke all on mayara.eventos_adiados from anon, authenticated;

create or replace function mayara.adiar_evento(p_telefone text, p_payload jsonb)
returns bigint language plpgsql set search_path = '' as $$
declare v_id bigint;
begin
  insert into mayara.eventos_adiados (telefone_chave, payload)
  values (mayara.chave_telefone(p_telefone), coalesce(p_payload, '{}'::jsonb))
  returning id into v_id;
  return v_id;
end $$;

create or replace function mayara.reservar_eventos_adiados(p_agora timestamptz default now(), p_limite int default 10)
returns table (id bigint, payload jsonb)
language plpgsql set search_path = '' as $$
begin
  if not mayara.resposta_permitida(p_agora) then
    return;
  end if;
  return query
  with c as (
    select e.id from mayara.eventos_adiados e
     where e.processado_em is null and e.tentativas < 5
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

create or replace function mayara.reabrir_evento_adiado(p_id bigint, p_erro text)
returns void language plpgsql set search_path = '' as $$
begin
  update mayara.eventos_adiados set processado_em = null, erro = left(coalesce(p_erro, 'erro_desconhecido'), 300)
   where id = p_id;
end $$;

revoke all on function mayara.adiar_evento(text, jsonb) from public, anon, authenticated;
revoke all on function mayara.reservar_eventos_adiados(timestamptz, int) from public, anon, authenticated;
revoke all on function mayara.reabrir_evento_adiado(bigint, text) from public, anon, authenticated;
