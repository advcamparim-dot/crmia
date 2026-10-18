-- Sessoes revogaveis do painel: o servidor guarda so o hash SHA-256 do token; logout revoga.
create table painel.sessoes (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  emitida_em timestamptz not null default now(),
  expira_em timestamptz not null,
  revogada_em timestamptz
);
alter table painel.sessoes enable row level security;
revoke all on painel.sessoes from public, anon, authenticated;

create or replace function painel.sessao_criar(p_hash text, p_expira timestamptz)
returns uuid language plpgsql set search_path = '' as $$
declare v_id uuid;
begin
  if p_hash is null or p_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'hash da sessao fora do formato (64 caracteres hexadecimais)';
  end if;
  insert into painel.sessoes (token_hash, expira_em) values (p_hash, p_expira) returning id into v_id;
  return v_id;
end $$;

create or replace function painel.sessao_valida(p_hash text)
returns boolean language sql stable set search_path = '' as $$
  select exists (
    select 1 from painel.sessoes s
     where s.token_hash = p_hash and s.revogada_em is null and s.expira_em > now()
  )
$$;

create or replace function painel.sessao_revogar(p_hash text)
returns void language sql set search_path = '' as $$
  update painel.sessoes set revogada_em = now() where token_hash = p_hash and revogada_em is null
$$;

revoke all on function painel.sessao_criar(text, timestamptz) from public, anon, authenticated;
revoke all on function painel.sessao_valida(text) from public, anon, authenticated;
revoke all on function painel.sessao_revogar(text) from public, anon, authenticated;
grant execute on function painel.sessao_criar(text, timestamptz), painel.sessao_valida(text), painel.sessao_revogar(text) to painel_leitura;
grant usage on schema painel to painel_leitura;
