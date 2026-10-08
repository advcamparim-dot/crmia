-- supabase/tests/0030_acoes_pendentes.test.sql
begin;
do $t$
declare r text;
begin
  -- chave desligada por padrao
  assert (select valor from mayara.config where chave = 'central_linguagem_livre') = 'false', 'chave nasce desligada';

  -- lead de teste
  insert into mayara.leads_autorizados (telefone, nome, status) values ('+5511999990701', 'Fulano Pendente', 'ativo');

  -- cria e mostra o resumo com instrucao de confirmar
  r := mayara.criar_acao_pendente('assumir', '{"telefone":"+5511999990701"}'::jsonb, 'Assumir o lead Fulano Pendente (final 0701)', '5514997022609');
  assert r like '%Assumir o lead Fulano Pendente%' and r like '%sim%', 'resumo com pedido de confirmacao: ' || r;
  assert (select count(*) from mayara.acoes_pendentes where estado = 'pendente') = 1, 'uma pendente';

  -- uma pendencia por vez (acao x acao e acao x instrucao)
  r := mayara.criar_acao_pendente('devolver', '{"telefone":"+5511999990701"}'::jsonb, 'Devolver', '5514997022609');
  assert r like '%aguardando%', 'segunda acao recusada: ' || r;
  r := mayara.criar_pendente('Quando perguntarem de honorarios, nao cite valores.', 'original', '5514997022609');
  assert r like '%aguardando%', 'instrucao recusada com acao pendente: ' || r;
  assert (select count(*) from mayara.instrucoes where estado = 'pendente') = 0, 'nenhuma instrucao pendente criada';

  -- "nao" cancela sem executar
  r := mayara.confirmar_pendente('nao');
  assert r like '%cancelei%', 'cancela: ' || r;
  assert (select status from mayara.leads_autorizados where telefone = '+5511999990701') = 'ativo', 'nao assumiu';
  assert (select count(*) from mayara.acoes_pendentes where estado = 'cancelada') = 1, 'marcada cancelada';

  -- "sim" confirma e executa uma unica vez
  perform mayara.criar_acao_pendente('assumir', '{"telefone":"+5511999990701"}'::jsonb, 'Assumir o lead Fulano Pendente (final 0701)', '5514997022609');
  r := mayara.confirmar_pendente('sim');
  assert r like '%parou de responder%', 'executou assumir: ' || r;
  assert (select status from mayara.leads_autorizados where telefone = '+5511999990701') = 'bloqueado', 'lead bloqueado';
  r := mayara.confirmar_pendente('sim');
  assert r like '%Não há nenhuma%', 'segundo sim nao repete: ' || r;

  -- devolver
  perform mayara.criar_acao_pendente('devolver', '{"telefone":"+5511999990701"}'::jsonb, 'Devolver o lead', '5514997022609');
  r := mayara.confirmar_pendente('sim');
  assert r like '%voltou a atender%', 'executou devolver: ' || r;
  assert (select status from mayara.leads_autorizados where telefone = '+5511999990701') = 'ativo', 'lead ativo de novo';

  -- efeitos para o n8n (pausar e ligar)
  perform mayara.criar_acao_pendente('pausar', '{}'::jsonb, 'Pausar a Mayara para todos os leads', '5514997022609');
  r := mayara.confirmar_pendente('sim');
  assert split_part(r, E'\n', 1) = '@efeito {"tipo":"modo","aiMode":"paused"}', 'efeito de pausar: ' || r;
  perform mayara.criar_acao_pendente('ligar', '{}'::jsonb, 'Ligar a Mayara', '5514997022609');
  r := mayara.confirmar_pendente('sim');
  assert split_part(r, E'\n', 1) = '@efeito {"tipo":"modo","aiMode":"active"}', 'efeito de ligar: ' || r;

  -- regras: desfazer e reativar pelo numero
  insert into mayara.instrucoes (texto, estado, autor_chave) values ('Regra de teste para desfazer.', 'ativa', 't');
  perform mayara.criar_acao_pendente('desfazer_regra', jsonb_build_object('numero', (select max(id) from mayara.instrucoes)), 'Desfazer a regra', '5514997022609');
  r := mayara.confirmar_pendente('sim');
  assert r like 'Desfeita:%', 'desfez a regra: ' || r;
  perform mayara.criar_acao_pendente('reativar_regra', jsonb_build_object('numero', (select max(id) from mayara.instrucoes)), 'Reativar a regra', '5514997022609');
  r := mayara.confirmar_pendente('sim');
  assert r like 'Reativada:%', 'reativou a regra: ' || r;

  -- travas que ja existiam continuam valendo na confirmacao
  insert into mayara.leads_autorizados (telefone, nome, status) values ('+5511999990702', 'Sem Interesse', 'sem_interesse');
  perform mayara.criar_acao_pendente('assumir', '{"telefone":"+5511999990702"}'::jsonb, 'Assumir', '5514997022609');
  r := mayara.confirmar_pendente('sim');
  assert r like '%sem interesse%', 'respeita sem_interesse: ' || r;

  -- abordar ainda nao habilitada nesta fase
  r := mayara.criar_acao_pendente('abordar', '{"telefone":"+5511999990701"}'::jsonb, 'Abordar', '5514997022609');
  assert r like '%ainda não%', 'abordar recusada: ' || r;
  assert (select count(*) from mayara.acoes_pendentes where acao = 'abordar') = 0, 'abordar nao gravada';

  -- acao desconhecida e argumentos invalidos
  r := mayara.criar_acao_pendente('apagar_tudo', '{}'::jsonb, 'x', '5514997022609');
  assert r like '%não reconhecida%', 'acao fora da lista: ' || r;
  r := mayara.criar_acao_pendente('assumir', '{"telefone":"123"}'::jsonb, 'Assumir', '5514997022609');
  assert r like '%inválido%', 'telefone invalido: ' || r;

  -- expiracao
  perform mayara.criar_acao_pendente('pausar', '{}'::jsonb, 'Pausar a Mayara', '5514997022609');
  update mayara.acoes_pendentes set confirmar_ate = now() - interval '1 minute' where estado = 'pendente';
  r := mayara.confirmar_pendente('sim');
  assert r like '%expirou%', 'expirada: ' || r;

  -- sem nada pendente, o caminho antigo das instrucoes continua igual
  -- instrucao pendente nao e escondida por uma acao expirada recentemente
  r := mayara.criar_pendente('Sempre pergunte a cidade do lead.', 'original', '5514997022609');
  assert r like '%Confirma?%', 'instrucao criada apos expiracao: ' || r;
  r := mayara.confirmar_pendente('sim');
  assert r like 'Pronto, vale a partir%', 'sim confirma a instrucao e nao a acao expirada: ' || r;
  r := mayara.criar_pendente('Nunca prometa resultado ao lead.', 'original', '5514997022609');
  assert r like '%Confirma?%', 'instrucao segue funcionando: ' || r;
  r := mayara.confirmar_pendente('sim');
  assert r like 'Pronto, vale a partir%', 'confirmacao de instrucao segue funcionando: ' || r;

  -- acesso fechado
  assert not has_function_privilege('anon', 'mayara.criar_acao_pendente(text,jsonb,text,text)', 'execute'), 'anon sem execute (criar)';
  assert not has_function_privilege('authenticated', 'mayara.confirmar_acao_pendente(text)', 'execute'), 'authenticated sem execute (confirmar)';
  assert not has_table_privilege('anon', 'mayara.acoes_pendentes', 'select'), 'anon sem select';
end $t$;
rollback;
select 'OK 0030' as resultado;
