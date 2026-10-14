-- supabase/tests/0050_retencao_abordagem.test.sql
begin;
do $t$
declare n int; ca text := mayara.chave_telefone('+5511999990501'); cb text := mayara.chave_telefone('+5511999990502');
begin
  insert into mayara.leads_autorizados (telefone, nome, status, abordagem_ate) values
    ('+5511999990501', 'Abordado Teste', 'ativo', now() + interval '2 hours'),
    ('+5511999990502', 'Comum Teste', 'ativo', null),
    ('+5511999990503', 'Vencido Teste', 'ativo', now() - interval '1 hour'),
    ('+5511999990504', 'Assumido Teste', 'bloqueado', now() + interval '2 hours');
  update mayara.eventos_adiados set processado_em = now() where processado_em is null;
  insert into mayara.eventos_adiados (telefone_chave, payload) values (ca, '{"a":1}'::jsonb), (cb, '{"b":1}'::jsonb);
  update mayara.config set valor = 'true' where chave = 'respostas_retidas';

  assert mayara.resposta_permitida_para('+5511999990501') = true, 'retido: lead com abordagem autorizada responde';
  assert mayara.resposta_permitida_para('+5511999990502') = false, 'retido: lead comum nao responde';
  assert mayara.resposta_permitida_para('+5511999990503') = false, 'retido: abordagem vencida nao libera';
  assert mayara.resposta_permitida_para('+5511999990504') = false, 'retido: lead assumido nao libera';

  select count(*) into n from mayara.reservar_eventos_adiados(now(), 10);
  assert n = 1, 'retido: so o evento do lead abordado e liberado, liberados=' || n;
  assert (select processado_em is not null from mayara.eventos_adiados where telefone_chave = ca), 'evento do abordado processado';
  assert (select processado_em is null from mayara.eventos_adiados where telefone_chave = cb), 'evento do comum continua retido';

  update mayara.config set valor = 'false' where chave = 'respostas_retidas';
  assert mayara.resposta_permitida_para('+5511999990501') = true, 'sem retencao, abordado continua respondendo';
end $t$;
rollback;
select 'OK 0050';
