-- supabase/migrations/0028_painel_gasto_anuncios.sql
create table painel.gasto_anuncios (
  id bigserial primary key,
  campanha text not null check (btrim(campanha) <> ''),
  mes date not null check (mes = date_trunc('month', mes)::date),
  valor numeric(12, 2) not null check (valor > 0),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create unique index gasto_anuncios_chave on painel.gasto_anuncios (lower(btrim(campanha)), mes);
alter table painel.gasto_anuncios enable row level security;
revoke all on painel.gasto_anuncios from public, anon, authenticated, painel_leitura;

create or replace function painel.registrar_gasto(p_campanha text, p_mes date, p_valor numeric)
returns jsonb language plpgsql set search_path = '' as $$
declare v_mes date := date_trunc('month', p_mes)::date;
begin
  insert into painel.gasto_anuncios (campanha, mes, valor)
  values (btrim(p_campanha), v_mes, p_valor)
  on conflict (lower(btrim(campanha)), mes) do update
    set valor = excluded.valor, atualizado_em = now();
  return jsonb_build_object('campanha', btrim(p_campanha), 'mes', v_mes, 'valor', p_valor);
end $$;
revoke all on function painel.registrar_gasto(text, date, numeric) from public, anon, authenticated, painel_leitura;
