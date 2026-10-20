-- Arranjo dos quadros da tela inicial: uma unica linha (login unico). Unica escrita da etapa 2.
create table painel.layout (
  id int primary key check (id = 1),
  layout jsonb not null,
  atualizado_em timestamptz not null default now()
);
alter table painel.layout enable row level security;
revoke all on painel.layout from public, anon, authenticated;

create or replace function painel.layout_ler()
returns jsonb language sql stable set search_path = '' as $$
  select l.layout from painel.layout l where l.id = 1
$$;

-- Valida a forma, nao o catalogo (o catalogo vive no app; ids desconhecidos sao descartados na leitura).
create or replace function painel.layout_salvar(p_layout jsonb)
returns void language plpgsql set search_path = '' as $$
declare
  v_item jsonb;
  v_n int;
  v_campo text;
  v_valor jsonb;
begin
  if p_layout is null or jsonb_typeof(p_layout) <> 'object' then
    raise exception 'arranjo invalido: precisa ser um objeto';
  end if;
  if octet_length(p_layout::text) > 20480 then
    raise exception 'arranjo invalido: maior que 20 KB';
  end if;
  if p_layout -> 'versao' is distinct from to_jsonb(1) then
    raise exception 'arranjo invalido: versao desconhecida';
  end if;
  if jsonb_typeof(p_layout -> 'itens') is distinct from 'array' then
    raise exception 'arranjo invalido: itens precisa ser uma lista';
  end if;
  v_n := jsonb_array_length(p_layout -> 'itens');
  if v_n > 40 then
    raise exception 'arranjo invalido: mais de 40 itens';
  end if;
  for v_item in select * from jsonb_array_elements(p_layout -> 'itens') loop
    if jsonb_typeof(v_item) <> 'object' or jsonb_typeof(v_item -> 'id') is distinct from 'string' then
      raise exception 'arranjo invalido: item sem id';
    end if;
    foreach v_campo in array array['x', 'y', 'w', 'h'] loop
      v_valor := v_item -> v_campo;
      if jsonb_typeof(v_valor) is distinct from 'number' or (v_valor::text) !~ '^[0-9]+$' then
        raise exception 'arranjo invalido: % precisa ser inteiro', v_campo;
      end if;
    end loop;
    if (v_item ->> 'w')::int not between 1 and 12 or (v_item ->> 'h')::int not between 1 and 40
       or (v_item ->> 'x')::int not between 0 and 11 or (v_item ->> 'y')::int not between 0 and 1000
       or (v_item ->> 'x')::int + (v_item ->> 'w')::int > 12 then
      raise exception 'arranjo invalido: posicao ou tamanho fora da faixa';
    end if;
  end loop;
  insert into painel.layout (id, layout, atualizado_em) values (1, p_layout, now())
  on conflict (id) do update set layout = excluded.layout, atualizado_em = excluded.atualizado_em;
end $$;

revoke all on function painel.layout_ler() from public, anon, authenticated;
revoke all on function painel.layout_salvar(jsonb) from public, anon, authenticated;
grant execute on function painel.layout_ler() to painel_leitura;
grant execute on function painel.layout_salvar(jsonb) to painel_leitura;
