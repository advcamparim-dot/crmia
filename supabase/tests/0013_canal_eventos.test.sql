-- supabase/tests/0013_canal_eventos.test.sql
-- Rodar inteiro (execute_sql). Dados ficticios; termina em rollback.
begin;

do $t$
declare ok1 boolean; ok2 boolean; ok3 boolean;
begin
  -- canal do escritorio cadastrado em observacao: evolution e inativo (nada envia por ele)
  assert (select provedor from mayara.canais where canal_id = 'escritorio') = 'evolution', 'canal escritorio e evolution';
  assert (select ativo from mayara.canais where canal_id = 'escritorio') = false, 'canal escritorio nasce inativo';
  assert (mayara.pode_enviar('escritorio', '5511999990301', 'texto') ->> 'motivo') = 'canal_inativo', 'inativo nao envia';

  -- segredo do webhook: compara o hash e recusa vazio, nulo e errado
  update mayara.config set valor = encode(extensions.digest('segredo-de-teste', 'sha256'), 'hex') where chave = 'evolution_segredo_sha256';
  if not found then
    insert into mayara.config (chave, valor) values ('evolution_segredo_sha256', encode(extensions.digest('segredo-de-teste', 'sha256'), 'hex'));
  end if;
  ok1 := mayara.conferir_segredo_canal('segredo-de-teste');
  ok2 := mayara.conferir_segredo_canal('outro');
  ok3 := mayara.conferir_segredo_canal(null);
  assert ok1 = true, 'segredo certo passa';
  assert ok2 = false and ok3 = false, 'segredo errado ou nulo falha';
  assert mayara.conferir_segredo_canal('') = false, 'segredo vazio falha';
  delete from mayara.config where chave = 'evolution_segredo_sha256' and valor = encode(extensions.digest('segredo-de-teste', 'sha256'), 'hex');
  assert mayara.conferir_segredo_canal('segredo-de-teste') = false, 'sem segredo configurado nada passa';

  -- registro de evento: aceito guarda o remetente por chave e o tamanho, nunca o texto
  perform mayara.registrar_evento_canal('escritorio', 'evolution', 'aceito', null, '+5511999990301', 'text', 20, false);
  perform mayara.registrar_evento_canal('escritorio', 'evolution', 'descartado', 'grupo', null, null, null, null);
  assert (select count(*) from mayara.canal_eventos where canal_id = 'escritorio') = 2, 'dois eventos gravados';
  assert (select remetente_chave from mayara.canal_eventos where resultado = 'aceito') = mayara.chave_telefone('+5511999990301'), 'remetente por chave';
  assert (select motivo from mayara.canal_eventos where resultado = 'descartado') = 'grupo', 'motivo do descarte';
  assert not exists (select 1 from information_schema.columns where table_schema = 'mayara' and table_name = 'canal_eventos' and column_name in ('texto', 'mensagem', 'corpo')), 'nenhuma coluna guarda o conteudo da mensagem';

  -- resultado invalido e recusado pela tabela
  begin
    perform mayara.registrar_evento_canal('escritorio', 'evolution', 'qualquer', null, null, null, null, null);
    assert false, 'resultado invalido deveria falhar';
  exception when check_violation then null;
  end;

  -- acesso: anon e authenticated nao enxergam nem executam
  assert not has_table_privilege('anon', 'mayara.canal_eventos', 'select'), 'anon sem select';
  assert not has_function_privilege('anon', 'mayara.registrar_evento_canal(text,text,text,text,text,text,int,boolean)', 'execute'), 'anon sem execute (registrar)';
  assert not has_function_privilege('authenticated', 'mayara.conferir_segredo_canal(text)', 'execute'), 'authenticated sem execute (segredo)';
end $t$;

rollback;
select 'OK 0013' as resultado;
