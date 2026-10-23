begin;
do $$
declare v_tel text; v_antes integer; v_depois integer;
begin
  select la.telefone into v_tel from painel.fila_atencao() f join mayara.leads_autorizados la on la.telefone_chave = mayara.chave_telefone(f.telefone)
   where f.tipo in ('lead_esperando', 'transferencia') limit 1;
  if v_tel is not null then
    select count(*) into v_antes from painel.fila_atencao() where tipo in ('lead_esperando', 'transferencia');
    assert painel.fila_dispensar(v_tel), 'dispensa lead da lista';
    select count(*) into v_depois from painel.fila_atencao() where tipo in ('lead_esperando', 'transferencia');
    assert v_depois = v_antes - 1, 'o item sai da fila';
  end if;
  assert not painel.fila_dispensar('+5500000000000'), 'numero fora da lista nao entra';
  assert not painel.fila_dispensar(null), 'nulo nao entra';
end $$;
select 'OK 0087';
rollback;
