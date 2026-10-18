create table if not exists painel.sessoes_painel (
  hash text primary key,
  emitida_em timestamptz not null default now(),
  expira_em timestamptz not null,
  revogada_em timestamptz
);

alter table painel.sessoes_painel enable row level security;
revoke all on painel.sessoes_painel from public, anon, authenticated, painel_leitura;

create or replace function painel.criar_sessao(p_hash text, p_expira_em timestamptz)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'hash de sessao invalido';
  end if;
  if p_expira_em <= now() then
    raise exception 'expiracao da sessao deve estar no futuro';
  end if;
  insert into painel.sessoes_painel (hash, expira_em) values (p_hash, p_expira_em);
end $$;

create or replace function painel.sessao_valida(p_hash text, p_agora timestamptz default now())
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from painel.sessoes_painel
     where hash = p_hash and revogada_em is null and expira_em > p_agora
  )
$$;

create or replace function painel.revogar_sessao(p_hash text, p_agora timestamptz default now())
returns void language sql security definer set search_path = '' as $$
  update painel.sessoes_painel
     set revogada_em = coalesce(revogada_em, p_agora)
   where hash = p_hash
$$;

revoke all on function painel.criar_sessao(text, timestamptz) from public, anon, authenticated;
revoke all on function painel.sessao_valida(text, timestamptz) from public, anon, authenticated;
revoke all on function painel.revogar_sessao(text, timestamptz) from public, anon, authenticated;
grant execute on function painel.criar_sessao(text, timestamptz) to painel_leitura;
grant execute on function painel.sessao_valida(text, timestamptz) to painel_leitura;
grant execute on function painel.revogar_sessao(text, timestamptz) to painel_leitura;
