-- Registro de falhas de agendamento (hoje so viravam Task no EspoCRM), para a fila "Precisa de voce" do painel.
create table painel.falhas_agendamento (
  id bigserial primary key,
  telefone_chave text not null,
  motivo text not null default 'desconhecido' check (char_length(motivo) <= 200),
  criada_em timestamptz not null default now(),
  resolvida_em timestamptz
);
create index falhas_agendamento_chave_idx on painel.falhas_agendamento (telefone_chave, criada_em desc);
alter table painel.falhas_agendamento enable row level security;
revoke all on painel.falhas_agendamento from public, anon, authenticated;

-- Idempotente: nao duplica a falha em aberto do mesmo lead nos ultimos 10 minutos.
create or replace function painel.registrar_falha_agendamento(p_telefone text, p_motivo text)
returns bigint language plpgsql set search_path = '' as $$
declare
  v_chave text := mayara.chave_telefone(p_telefone);
  v_id bigint;
begin
  if v_chave is null then
    raise exception 'telefone invalido para registrar a falha de agendamento';
  end if;
  select f.id into v_id from painel.falhas_agendamento f
   where f.telefone_chave = v_chave and f.resolvida_em is null and f.criada_em > now() - interval '10 minutes'
   order by f.criada_em desc limit 1;
  if v_id is not null then
    return v_id;
  end if;
  insert into painel.falhas_agendamento (telefone_chave, motivo)
  values (v_chave, left(coalesce(nullif(btrim(p_motivo), ''), 'desconhecido'), 200))
  returning id into v_id;
  return v_id;
end $$;

revoke all on function painel.registrar_falha_agendamento(text, text) from public, anon, authenticated;
grant execute on function painel.registrar_falha_agendamento(text, text) to painel_leitura;
