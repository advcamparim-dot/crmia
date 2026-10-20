-- Rodar inteiro (execute_sql). Termina em rollback, entao nao altera o arranjo real.
begin;
do $t$
declare
  v jsonb; itens jsonb; i int; falhou boolean;
  ok_layout jsonb := '{"versao":1,"itens":[{"id":"fila","x":0,"y":0,"w":6,"h":8},{"id":"fontes","x":6,"y":0,"w":3,"h":4,"oculto":true}]}';
begin
  if not exists (select 1 from painel.layout) then assert painel.layout_ler() is null, 'nunca salvo devolve nulo'; end if;

  perform painel.layout_salvar(ok_layout);
  assert painel.layout_ler() = ok_layout, 'ler devolve o que foi salvo';

  perform painel.layout_salvar('{"versao":1,"itens":[{"id":"kpi-canal","x":0,"y":0,"w":2,"h":2}]}');
  assert (select count(*) from painel.layout) = 1, 'segunda gravacao substitui, continua uma linha';
  assert painel.layout_ler() -> 'itens' -> 0 ->> 'id' = 'kpi-canal', 'segunda gravacao substituiu';

  -- recusas: cada uma deve levantar excecao e deixar o salvo como estava
  falhou := false; begin perform painel.layout_salvar('{"versao":2,"itens":[]}'); exception when others then falhou := true; end;
  assert falhou, 'versao diferente de 1 e recusada';
  falhou := false; begin perform painel.layout_salvar('[1,2]'); exception when others then falhou := true; end;
  assert falhou, 'JSON que nao e objeto e recusado';
  falhou := false; begin perform painel.layout_salvar(null); exception when others then falhou := true; end;
  assert falhou, 'nulo e recusado';
  falhou := false; begin perform painel.layout_salvar('{"versao":1,"itens":"x"}'); exception when others then falhou := true; end;
  assert falhou, 'itens que nao e lista e recusado';

  select jsonb_agg(jsonb_build_object('id', 'fila', 'x', 0, 'y', 0, 'w', 1, 'h', 1)) into itens from generate_series(1, 41);
  falhou := false; begin perform painel.layout_salvar(jsonb_build_object('versao', 1, 'itens', itens)); exception when others then falhou := true; end;
  assert falhou, 'mais de 40 itens e recusado';

  falhou := false; begin perform painel.layout_salvar('{"versao":1,"itens":[{"id":"fila","x":-1,"y":0,"w":2,"h":2}]}'); exception when others then falhou := true; end;
  assert falhou, 'x negativo e recusado';
  falhou := false; begin perform painel.layout_salvar('{"versao":1,"itens":[{"id":"fila","x":0,"y":0,"w":13,"h":2}]}'); exception when others then falhou := true; end;
  assert falhou, 'largura maior que 12 e recusada';
  falhou := false; begin perform painel.layout_salvar('{"versao":1,"itens":[{"id":"fila","x":11,"y":0,"w":2,"h":2}]}'); exception when others then falhou := true; end;
  assert falhou, 'x + w acima de 12 e recusado';
  falhou := false; begin perform painel.layout_salvar('{"versao":1,"itens":[{"id":"fila","x":0,"y":0,"w":2,"h":0}]}'); exception when others then falhou := true; end;
  assert falhou, 'altura zero e recusada';
  falhou := false; begin perform painel.layout_salvar('{"versao":1,"itens":[{"id":"fila","x":0,"y":1001,"w":2,"h":2}]}'); exception when others then falhou := true; end;
  assert falhou, 'y fora de faixa e recusado';
  falhou := false; begin perform painel.layout_salvar('{"versao":1,"itens":[{"id":"fila","x":"a","y":0,"w":2,"h":2}]}'); exception when others then falhou := true; end;
  assert falhou, 'valor nao numerico e recusado';
  falhou := false; begin perform painel.layout_salvar('{"versao":1,"itens":[{"x":0,"y":0,"w":2,"h":2}]}'); exception when others then falhou := true; end;
  assert falhou, 'item sem id e recusado';

  falhou := false;
  begin perform painel.layout_salvar(jsonb_build_object('versao', 1, 'itens', '[]'::jsonb, 'lixo', repeat('a', 21000)));
  exception when others then falhou := true; end;
  assert falhou, 'JSON acima de 20 KB e recusado';

  assert painel.layout_ler() -> 'itens' -> 0 ->> 'id' = 'kpi-canal', 'recusas nao alteraram o arranjo salvo';

  assert not has_function_privilege('anon', 'painel.layout_salvar(jsonb)', 'execute'), 'anon sem execute em salvar';
  assert not has_function_privilege('anon', 'painel.layout_ler()', 'execute'), 'anon sem execute em ler';
  assert not has_function_privilege('authenticated', 'painel.layout_salvar(jsonb)', 'execute'), 'authenticated sem execute em salvar';
  assert has_function_privilege('painel_leitura', 'painel.layout_salvar(jsonb)', 'execute'), 'painel_leitura executa salvar';
  assert has_function_privilege('painel_leitura', 'painel.layout_ler()', 'execute'), 'painel_leitura executa ler';
end $t$;
rollback;
select 'OK 0069' as resultado;
