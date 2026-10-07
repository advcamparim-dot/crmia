-- supabase/tests/0023_cartoes_agencia.test.sql
-- Rodar inteiro (execute_sql). Dados ficticios; termina em rollback.
begin;

do $t$
declare r jsonb;
begin
  -- grava um cartao criado
  r := mayara.registrar_cartao_agencia('t-msg-1', '+5511999990901', 'criado', null, 'crm-abc');
  assert (r ->> 'resultado') = 'criado', 'devolve o resultado: ' || r::text;
  assert (select count(*) from mayara.cartoes_agencia where message_id = 't-msg-1') = 1, 'gravou uma linha';
  assert (select crm_lead_id from mayara.cartoes_agencia where message_id = 't-msg-1') = 'crm-abc', 'guarda o id do lead no CRM';

  -- a mesma mensagem de novo (webhook repetido) atualiza em vez de duplicar
  r := mayara.registrar_cartao_agencia('t-msg-1', '+5511999990901', 'ja_existia', null, 'crm-abc');
  assert (select count(*) from mayara.cartoes_agencia where message_id = 't-msg-1') = 1, 'nao duplica por message_id';
  assert (select resultado from mayara.cartoes_agencia where message_id = 't-msg-1') = 'ja_existia', 'atualiza o resultado';

  -- cartao ilegivel (sem telefone) tambem fica registrado, com o motivo
  r := mayara.registrar_cartao_agencia('t-msg-2', null, 'ilegivel', 'sem_telefone', null);
  assert (select motivo from mayara.cartoes_agencia where message_id = 't-msg-2') = 'sem_telefone', 'guarda o motivo';
  assert (select telefone from mayara.cartoes_agencia where message_id = 't-msg-2') is null, 'telefone nulo quando ilegivel';

  -- resultado desconhecido e rejeitado
  begin
    perform mayara.registrar_cartao_agencia('t-msg-3', '+5511999990902', 'qualquer_coisa', null, null);
    assert false, 'resultado invalido deveria falhar';
  exception when check_violation then null;
  end;

  -- sem message_id nao grava
  begin
    perform mayara.registrar_cartao_agencia(null, '+5511999990903', 'criado', null, null);
    assert false, 'sem message_id deveria falhar';
  exception when not_null_violation then null;
  end;

  -- acesso fechado
  assert not has_table_privilege('anon', 'mayara.cartoes_agencia', 'select'), 'anon sem select';
  assert not has_table_privilege('authenticated', 'mayara.cartoes_agencia', 'select'), 'authenticated sem select';
  assert not has_function_privilege('anon', 'mayara.registrar_cartao_agencia(text,text,text,text,text)', 'execute'), 'anon sem execute';
  assert not has_function_privilege('authenticated', 'mayara.registrar_cartao_agencia(text,text,text,text,text)', 'execute'), 'authenticated sem execute';
end $t$;

rollback;
select 'OK 0023' as resultado;
