begin;
do $$
declare esp numeric;
begin
  assert (select count(*) from painel.previsao_taxas) = 5, 'cinco etapas ativas';
  assert (select count(*) from painel.previsao()) = 5, 'previsao tem cinco linhas';
  assert (select ticket_medio from painel.previsao() limit 1) > 0, 'ticket medio positivo';
  perform painel.previsao_definir('Proposta enviada', 0.5, 40);
  assert (select chance from painel.previsao() where etapa = 'Proposta enviada') = 0.5, 'chance alterada';
  assert (select esperados from painel.previsao() where etapa = 'Proposta enviada') = round((select leads from painel.previsao() where etapa = 'Proposta enviada') * 0.5, 2), 'esperados = leads x chance';
  begin perform painel.previsao_definir('Proposta enviada', 1.5, 20); assert false, 'chance > 1 devia falhar'; exception when raise_exception then null; end;
  begin perform painel.previsao_definir('Proposta enviada', 0.3, 30); assert false, 'prazo 30 devia falhar'; exception when check_violation then null; end;
  begin perform painel.previsao_definir('Contrato', 0.3, 20); assert false, 'etapa invalida devia falhar'; exception when raise_exception then null; end;
  perform painel.previsao_ticket_definir(9000);
  if (select count(*) from painel.contratos) < 3 then
    assert (select ticket_medio from painel.previsao() limit 1) = 9000 and (select ticket_origem from painel.previsao() limit 1) = 'definido', 'usa o valor do dono';
  end if;
  begin perform painel.previsao_ticket_definir(0); assert false, 'valor 0 devia falhar'; exception when raise_exception then null; end;
end $$;
select 'OK 0085';
rollback;
