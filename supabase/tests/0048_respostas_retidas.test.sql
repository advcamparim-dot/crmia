-- supabase/tests/0048_respostas_retidas.test.sql
begin;
do $t$
declare n int;
begin
  insert into mayara.leads_autorizados (telefone, nome, status, abordagem_ate) values ('+5511999990481', 'Retido Teste', 'ativo', now() + interval '1 hour');
  insert into mayara.eventos_adiados (telefone_chave, payload) values (mayara.chave_telefone('+5511999990481'), '{"x":1}'::jsonb);

  update mayara.config set valor = 'false' where chave = 'respostas_retidas';
  assert mayara.resposta_permitida_para('+5511999990481') = true, 'sem retencao, lead autorizado responde';

  update mayara.config set valor = 'true' where chave = 'respostas_retidas';
  assert mayara.respostas_retidas() = true, 'chave ligada';
  assert mayara.resposta_permitida_para('+5511999990481') = false, 'retido: nem lead autorizado responde';
  assert mayara.resposta_permitida_para('+5511999990999') = false, 'retido: ninguem responde';
  select count(*) into n from mayara.reservar_eventos_adiados(now(), 10);
  assert n = 0, 'retido: fila nao e liberada';
  assert exists (select 1 from mayara.eventos_adiados where telefone_chave = mayara.chave_telefone('+5511999990481') and processado_em is null), 'evento continua guardado';

  update mayara.config set valor = 'false' where chave = 'respostas_retidas';
  select count(*) into n from mayara.reservar_eventos_adiados(now(), 10);
  assert n >= 1, 'liberado: a fila volta a andar';
end $t$;
rollback;
select 'OK 0048';
