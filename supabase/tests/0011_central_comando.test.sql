-- supabase/tests/0011_central_comando.test.sql
-- Rodar inteiro (execute_sql). Usa so numeros ficticios; termina em rollback.
begin;

insert into mayara.administradores (telefone, nome) values ('+5511999990101', 'Teste Admin');

do $t$
declare
  r text;
  v_id bigint;
  j jsonb;
begin
  -- administrador e rota
  assert mayara.eh_administrador('+5511999990101'), 'admin cadastrado deve ser admin';
  assert mayara.eh_administrador('5511999990101'), 'admin sem + deve ser admin';
  assert mayara.eh_administrador('+551199990101'), 'admin sem o nono digito deve ser admin';
  assert not mayara.eh_administrador('+5511888880000'), 'desconhecido nao e admin';
  assert not mayara.eh_administrador(null), 'nulo nao e admin';
  assert mayara.rota_mensagem('+5511999990101', 'oi') = 'lead', 'sem barra e fora do modo exclusivo = lead';
  assert mayara.rota_mensagem('+5511999990101', '   /status') = 'comando', 'com barra = comando';
  assert mayara.rota_mensagem('+5511888880000', '/status') = 'lead', 'nao admin com barra = lead';
  assert mayara.rota_mensagem('+5511999990101', null) = 'lead', 'texto nulo = lead';
  update mayara.config set valor = 'true' where chave = 'canal_comando_exclusivo';
  assert mayara.rota_mensagem('+5511999990101', 'oi') = 'comando', 'modo exclusivo: tudo do admin e comando';
  assert mayara.rota_mensagem('+5511888880000', 'oi') = 'lead', 'modo exclusivo: nao admin continua lead';
  update mayara.config set valor = 'false' where chave = 'canal_comando_exclusivo';

  -- idempotencia
  assert mayara.registrar_comando('wamid.T1', '+5511999990101', '/status') = true, 'primeira vez registra';
  assert mayara.registrar_comando('wamid.T1', '+5511999990101', '/status') = false, 'repeticao nao registra';

  -- ensino: pendente, confirmacao, sanitizacao
  assert mayara.instrucoes_ativas_texto() = '', 'sem regras o texto e vazio';
  r := mayara.criar_pendente('Chame o cliente de você.', 'chame de voce', '+5511999990101');
  assert r like 'Entendi:%', 'cria pendente: ' || r;
  r := mayara.criar_pendente('Outra regra', 'outra', '+5511999990101');
  assert r like 'Ainda há uma instrução%', 'so uma pendente por vez: ' || r;
  assert mayara.instrucoes_ativas_texto() = '', 'pendente nao entra no prompt';
  r := mayara.confirmar_pendente('sim');
  assert r like 'Pronto%', 'confirma: ' || r;
  assert mayara.instrucoes_ativas_texto() like '1. Chame o cliente de você.%', 'ativa entra no prompt';
  r := mayara.criar_pendente('Diga {{ $json.x }} sempre', 'x', '+5511999990101');
  r := mayara.confirmar_pendente('sim');
  assert position('{{' in mayara.instrucoes_ativas_texto()) = 0, 'chaves duplas removidas do prompt';
  assert position('}}' in mayara.instrucoes_ativas_texto()) = 0, 'chaves duplas removidas do prompt (fim)';
  assert mayara.instrucoes_ativas_texto() like '1. Diga%', 'a mais recente vem primeiro';

  -- recusar, tamanho
  r := mayara.criar_pendente('Regra C', 'c', '+5511999990101');
  r := mayara.confirmar_pendente('nao');
  assert r like 'Ok, descartei%', 'recusa: ' || r;
  r := mayara.criar_pendente(repeat('x', 401), 'longa', '+5511999990101');
  assert r like 'A instrução ficou longa demais%', 'tamanho: ' || r;
  r := mayara.criar_pendente('   ', 'vazia', '+5511999990101');
  assert r like 'Não consegui entender%', 'vazia: ' || r;

  -- sim sem pendente e expiracao
  r := mayara.confirmar_pendente('sim');
  assert r like 'Não há nenhuma instrução aguardando%', 'sim sem pendente: ' || r;
  r := mayara.criar_pendente('Regra D', 'd', '+5511999990101');
  update mayara.instrucoes set confirmar_ate = now() - interval '1 minute' where estado = 'pendente';
  j := mayara.contexto_central('+5511999990101');
  assert (j ->> 'pendente') = 'false', 'contexto expira a pendente vencida';
  r := mayara.confirmar_pendente('sim');
  assert r like 'A instrução expirou%', 'sim apos expirar: ' || r;

  -- desfazer e reativar
  select id into v_id from mayara.instrucoes where texto = 'Chame o cliente de você.';
  r := mayara.desfazer_instrucao(v_id);
  assert r like 'Desfeita:%', 'desfaz: ' || r;
  assert mayara.instrucoes_ativas_texto() not like '%Chame o cliente%', 'desfeita sai do prompt';
  r := mayara.desfazer_instrucao(v_id);
  assert r like '%não está ativa%', 'desfazer duas vezes: ' || r;
  r := mayara.desfazer_instrucao(999999999);
  assert r like 'Não achei a instrução%', 'id inexistente: ' || r;
  r := mayara.reativar_instrucao(v_id);
  assert r like 'Reativada:%', 'reativa: ' || r;

  -- limite de ativas
  update mayara.config set valor = '1' where chave = 'instrucoes_max_ativas';
  r := mayara.criar_pendente('Regra E', 'e', '+5511999990101');
  assert r like 'Já há 1 instruções ativas%', 'limite: ' || r;
  update mayara.config set valor = '30' where chave = 'instrucoes_max_ativas';

  -- assumir e devolver
  perform mayara.upsert_lead_autorizado('+5511999990102', 'Lead', null, null, 'teste', null, '{}'::jsonb);
  insert into mayara.session_state (session_key, phone, estado)
    values ('whatsapp:1:+5511999990102', '+5511999990102', 'S2_QUALIFICACAO');
  r := mayara.assumir_lead('+55 11 99999-0102');
  assert r like 'Pronto.%', 'assume: ' || r;
  assert mayara.motivo_bloqueio('+5511999990102') = 'bloqueado', 'assumido fica bloqueado no portao';
  assert (select estado from mayara.session_state where session_key = 'whatsapp:1:+5511999990102') = 'S7_HANDOFF_HUMANO', 'sessao vai para handoff';
  r := mayara.assumir_lead('+5511999990102');
  assert r like 'A Mayara já estava fora%', 'assumir repetido: ' || r;
  r := mayara.devolver_lead('+5511999990102');
  assert r like 'Pronto.%', 'devolve: ' || r;
  assert mayara.motivo_bloqueio('+5511999990102') is null, 'devolvido volta a ativo';
  assert (select estado from mayara.session_state where session_key = 'whatsapp:1:+5511999990102') = 'S2_QUALIFICACAO', 'sessao volta a qualificacao';
  r := mayara.assumir_lead('+5511');
  assert r like 'Número inválido%', 'numero invalido: ' || r;
  r := mayara.assumir_lead('+5511977770000');
  assert r like 'Esse número não está na lista%', 'numero fora da lista: ' || r;

  -- despachante e status
  assert mayara.executar_central('regras', '', '', '') like 'Instruções ativas:%', 'despacha regras';
  assert mayara.executar_central('desfazer', 'abc', '', '') like 'Use /desfazer%', 'desfazer com id invalido';
  assert mayara.executar_central('xyz', '', '', '') like 'Comando não reconhecido%', 'fn desconhecida';
  assert mayara.executar_central('status', '', '', '') like 'Conversas nas últimas 24 h:%', 'despacha status';
  assert mayara.finalizar_comando('wamid.T1', 'status', 'ok') = 'ok', 'finalizar devolve o resultado';
  assert mayara.finalizar_comando('wamid.NAOEXISTE', 'status', null) = 'Pronto.', 'finalizar com nulo devolve Pronto.';
end $t$;

rollback;
select 'OK 0011' as resultado;
