-- supabase/tests/0060_abordagem_automatica_notificacao.test.sql
begin;
do $t$
declare n int; segunda timestamptz := timestamptz '2026-10-19 13:00:00+00';
begin
  perform mayara.criar_proposta('+5511999990901', 'Nota Um',   't-901', 'Boa tarde, Nota. Tudo bem? Aqui é a Mayara. Qual o banco?', '{}'::jsonb, 'banco');
  perform mayara.criar_proposta('+5511999990902', 'Nota Dois', 't-902', 'Boa tarde, Nota. Tudo bem? Aqui é a Mayara. Qual o banco?', '{}'::jsonb, 'banco');
  update mayara.propostas_abordagem set criado_em = segunda - interval '5 minutes', expira_em = segunda + interval '1 day' where telefone = '+5511999990901';
  update mayara.propostas_abordagem set criado_em = segunda - interval '40 minutes', expira_em = segunda + interval '1 day' where telefone = '+5511999990902';

  -- automatica desligada: comportamento atual, as duas notificam
  update mayara.config set valor = 'false' where chave = 'abordagem_automatica';
  select count(*) into n from mayara.reservar_notificacoes(segunda) where tipo = 'nova' and telefone_fim in ('0901', '0902');
  assert n = 2, 'desligada notifica as duas: ' || n;

  -- volta ao estado inicial para o segundo cenario
  update mayara.propostas_abordagem set notificada_em = null, lembrete_em = null where telefone in ('+5511999990901', '+5511999990902');

  -- automatica ligada: so a proposta com mais de 30 minutos notifica
  update mayara.config set valor = 'true' where chave = 'abordagem_automatica';
  select count(*) into n from mayara.reservar_notificacoes(segunda) where tipo = 'nova' and telefone_fim = '0901';
  assert n = 0, 'recente nao notifica com a automatica ligada: ' || n;
  assert (select notificada_em from mayara.propostas_abordagem where telefone = '+5511999990902') is not null, 'antiga notifica';

  -- a recente passa a notificar quando completa 30 minutos
  select count(*) into n from mayara.reservar_notificacoes(segunda + interval '31 minutes') where tipo = 'nova' and telefone_fim = '0901';
  assert n = 1, 'depois da carencia notifica: ' || n;
end $t$;
rollback;
select 'OK 0060';
