-- Rodar inteiro (execute_sql). Dados ficticios; termina em rollback.
begin;
do $t$
declare r jsonb;
begin
  update mayara.config set valor = '0' where chave = 'evolution_janela_horas';
  insert into mayara.leads_autorizados (telefone, nome, status) values
    ('+5511999991001', 'Janela Ativo', 'ativo'),
    ('+5511999991002', 'Janela Bloqueado', 'bloqueado'),
    ('+5511999991003', 'Janela SemInteresse', 'sem_interesse');
  insert into mayara.administradores (telefone, nome, ativo) values ('+5511999991010', 'Janela Admin', true), ('+5511999991011', 'Janela AdminInativo', false);

  r := mayara.pode_enviar('escritorio', '+5511999991001', 'texto');
  assert (r ->> 'ok') = 'true' and (r ->> 'provedor') = 'evolution', 'lead ativo sem janela: ' || r::text;
  r := mayara.pode_enviar('escritorio', '+5511999991002', 'texto');
  assert (r ->> 'ok') = 'false' and (r ->> 'motivo') = 'destino_nao_autorizado', 'bloqueado: ' || r::text;
  r := mayara.pode_enviar('escritorio', '+5511999991003', 'texto');
  assert (r ->> 'ok') = 'false' and (r ->> 'motivo') = 'destino_nao_autorizado', 'sem_interesse: ' || r::text;
  r := mayara.pode_enviar('escritorio', '+5511999991099', 'texto');
  assert (r ->> 'ok') = 'false' and (r ->> 'motivo') = 'destino_nao_autorizado', 'numero desconhecido: ' || r::text;
  r := mayara.pode_enviar('escritorio', '+5511999991011', 'texto');
  assert (r ->> 'ok') = 'false' and (r ->> 'motivo') = 'destino_nao_autorizado', 'admin inativo: ' || r::text;
  r := mayara.pode_enviar('escritorio', '+5511999991010', 'texto');
  assert (r ->> 'ok') = 'true', 'admin ativo: ' || r::text;
  r := mayara.pode_enviar('escritorio', '123', 'texto');
  assert (r ->> 'motivo') = 'destino_invalido', 'destino invalido: ' || r::text;

  update mayara.config set valor = '2' where chave = 'evolution_teto_por_minuto';
  insert into mayara.envios_log (canal_id, destino_chave, tipo, ok, provedor_message_id, origem) values
    ('escritorio', mayara.chave_telefone('+5511999991001'), 'texto', true, 'JAN1', 'teste'),
    ('escritorio', mayara.chave_telefone('+5511999991001'), 'texto', true, 'JAN2', 'teste');
  r := mayara.pode_enviar('escritorio', '+5511999991001', 'texto');
  assert (r ->> 'motivo') = 'teto_por_minuto', 'teto: ' || r::text;
  update mayara.config set valor = '20' where chave = 'evolution_teto_por_minuto';

  update mayara.config set valor = '48' where chave = 'evolution_janela_horas';
  r := mayara.pode_enviar('escritorio', '+5511999991001', 'texto');
  assert (r ->> 'ok') = 'false' and (r ->> 'motivo') = 'fora_da_janela', 'janela religada: ' || r::text;
end $t$;
rollback;
select 'OK 0063' as resultado;
