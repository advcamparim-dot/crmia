begin;
do $t$
declare r text;
begin
  update mayara.config set valor = 'true' where chave = 'abordagem_assistida';
  update mayara.config set valor = 'false' where chave = 'abordagem_automatica';
  update mayara.config set valor = '7' where chave = 'abordagem_auto_teto_hora';

  r := mayara.executar_central('abordagem', 'automatica status', '', '+5511999990001');
  assert r like 'Liberação automática: desligada%' and r like '%7 por hora%', 'status desligada: ' || r;

  r := mayara.executar_central('abordagem', 'automatica', '', '+5511999990001');
  assert r like 'Liberação automática: desligada%', 'sem acao = status: ' || r;

  r := mayara.executar_central('abordagem', 'automatica ligar', '', '+5511999990001');
  assert r like 'Liberação automática ligada%', 'ligar: ' || r;
  assert (select valor from mayara.config where chave = 'abordagem_automatica') = 'true', 'chave ligada';
  r := mayara.executar_central('abordagem', 'automatica status', '', '+5511999990001');
  assert r like 'Liberação automática: ligada%', 'status ligada: ' || r;

  r := mayara.executar_central('abordagem', 'automatica desligar', '', '+5511999990001');
  assert r like 'Liberação automática desligada%', 'desligar: ' || r;
  assert (select valor from mayara.config where chave = 'abordagem_automatica') = 'false', 'chave desligada';

  update mayara.config set valor = 'false' where chave = 'abordagem_assistida';
  r := mayara.executar_central('abordagem', 'automatica ligar', '', '+5511999990001');
  assert r like 'Não liguei%', 'recusa sem assistida: ' || r;
  assert (select valor from mayara.config where chave = 'abordagem_automatica') = 'false', 'continua desligada';

  r := mayara.executar_central('abordagem', 'qualquer coisa', '', '+5511999990001');
  assert r like 'Use /abordagem automatica%', 'uso: ' || r;
  r := mayara.executar_central('abordagem', '', '', '+5511999990001');
  assert r like 'Use /abordagem automatica%', 'uso vazio: ' || r;
  assert mayara.executar_central('followup', 'status', '', 'x') is not null, 'followup continua';
end $t$;
rollback;
select 'OK 0061';
