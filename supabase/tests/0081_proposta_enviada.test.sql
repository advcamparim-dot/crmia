-- Rodar inteiro (execute_sql). Dados sinteticos (+55119999910xx); termina em rollback.
begin;
do $t$
declare
  seg timestamptz := '2026-12-08 10:30:00-03'; -- terca, dentro do follow-up
  r text; j jsonb; k1 text := mayara.chave_telefone('+5511999991001'); k2 text := mayara.chave_telefone('+5511999991002');
  k3 text := mayara.chave_telefone('+5511999991003'); k4 text := mayara.chave_telefone('+5511999991004');
  k5 text := mayara.chave_telefone('+5511999991005'); n int; pid bigint; hoje date := painel._hoje();
begin
  insert into mayara.leads_autorizados (telefone, nome, origem, status) values
    ('+5511999991001', 'Carla Sintetica', 'x', 'ativo'), ('+5511999991002', 'Darpex Darpex', 'x', 'ativo'),
    ('+5511999991003', 'Bruno Sintetico', 'x', 'ativo'), ('+5511999991004', 'Dina Sintetica', 'x', 'ativo');

  -- cadencia 3, 7, 14 e 25 dias uteis a partir de 01/12/2026 (terca)
  assert (select array_agg(to_char((devido_em at time zone 'America/Sao_Paulo')::date, 'DD/MM') order by etapa)
            from mayara.agenda_followup('proposta', '2026-12-01 00:00:00-03')) = array['04/12', '09/12', '17/12', '31/12'], 'datas dos 4 lembretes';

  -- registrar: bloqueia o lead, cria a proposta e informa as datas
  r := mayara.registrar_proposta('+5511999991001', null, hoje - 7, 'adm');
  assert r like 'Proposta registrada para Carla Sintetica (final 1001)%' and r like '%até 4 lembretes%' and r like '%alerta%', 'resumo: ' || r;
  assert (select status from mayara.leads_autorizados where telefone_chave = k1) = 'bloqueado', 'lead bloqueado';
  assert (select count(*) from mayara.proposta_enviada where telefone_chave = k1 and estado = 'ativa') = 1, 'uma proposta ativa';
  r := mayara.registrar_proposta('+5511999991001', null, hoje - 7, 'adm');
  assert (select count(*) from mayara.proposta_enviada where telefone_chave = k1 and estado = 'ativa') = 1 and exists (select 1 from mayara.proposta_enviada where telefone_chave = k1 and motivo = 'substituida'), 'registrar de novo substitui a anterior';
  assert mayara.registrar_proposta('123', null, null, 'adm') like 'Número inválido%', 'telefone invalido';
  assert mayara.registrar_proposta('+5511999991001', null, hoje + 1, 'adm') like 'A data da proposta%', 'data futura recusada';
  assert mayara.registrar_proposta('+5511999991001', null, hoje - 200, 'adm') like 'A data da proposta%', 'data muito antiga recusada';
  -- lead fora da lista: cria bloqueado
  r := mayara.registrar_proposta('+5511999991099', 'Fora da Lista', hoje, 'adm');
  assert (select status from mayara.leads_autorizados where telefone_chave = mayara.chave_telefone('+5511999991099')) = 'bloqueado', 'lead fora da lista entra bloqueado';
  -- lead sem_interesse volta a bloqueado porque a equipe disse que enviou proposta
  update mayara.leads_autorizados set status = 'sem_interesse' where telefone_chave = k3;
  perform mayara.registrar_proposta('+5511999991003', null, hoje, 'adm');
  assert (select status from mayara.leads_autorizados where telefone_chave = k3) = 'bloqueado', 'sem_interesse com proposta registrada vira bloqueado';

  -- lembretes: desligado, depois ligado
  update mayara.canal_estado set estado = 'open' where canal_id = 'escritorio';
  assert mayara.proposta_proximo_lembrete(seg) ->> 'motivo' = 'desligado', 'desligado por padrao';
  update mayara.config set valor = 'ligado' where chave = 'proposta_lembrete_modo';
  -- proposta de Carla enviada em 01/12 (ajusta a data da ativa)
  update mayara.proposta_enviada set enviada_em = date '2026-12-01', criado_em = now() where telefone_chave = k1 and estado = 'ativa';
  update mayara.proposta_enviada set estado = 'encerrada', motivo = 'teste' where telefone_chave in (k3, mayara.chave_telefone('+5511999991099'));
  j := mayara.proposta_proximo_lembrete(seg);
  assert (j ->> 'enviar')::boolean and (j ->> 'etapa')::int = 1, 'no 4o dia util do envio vence o lembrete 1: ' || j::text;
  assert j ->> 'texto' like 'Olá, Carla. Aqui é a Mayara, do Camparim Advogados. Passando para saber se você conseguiu analisar a proposta%', 'texto 1 com nome: ' || (j ->> 'texto');
  assert j ->> 'destino' = '+5511999991001', 'destino';
  assert j ->> 'texto' !~* '(desconto|valor de|urgente|ultim[ao] chance|garant)', 'sem promessa nem pressao';
  perform mayara.proposta_lembrete_registrar((j ->> 'proposta_id')::bigint, 1, true, null);
  assert (select etapa_atual from mayara.proposta_enviada where telefone_chave = k1 and estado = 'ativa') = 1, 'etapa 1 registrada';
  assert mayara.proposta_proximo_lembrete(seg) ->> 'motivo' = 'fila_vazia', 'o lembrete 2 so vence em 09/12';
  insert into mayara.envios_log (canal_id, destino_chave, tipo, ok, provedor_message_id, origem, criado_em)
    values ('escritorio', k1, 'texto', true, 'PL-1', 'proposta_lembrete', seg);
  assert mayara.proposta_proximo_lembrete(seg + interval '5 minutes') ->> 'motivo' in ('intervalo', 'fila_vazia'), 'respeita o intervalo entre envios';
  j := mayara.proposta_proximo_lembrete(seg + interval '1 day');
  assert (j ->> 'enviar')::boolean and (j ->> 'etapa')::int = 2 and j ->> 'texto' like 'Carla, tudo bem? Ficou alguma dúvida%', 'lembrete 2 em 09/12: ' || j::text;

  -- limites: expediente, teto diario, falhas
  assert mayara.proposta_proximo_lembrete('2026-12-06 10:30:00-03') ->> 'motivo' = 'fora_do_expediente', 'domingo nao envia';
  update mayara.config set valor = '1' where chave = 'proposta_limite_dia';
  assert mayara.proposta_proximo_lembrete(seg + interval '5 minutes') ->> 'motivo' = 'teto_dia', 'teto diario de lembretes';
  update mayara.config set valor = '20' where chave = 'proposta_limite_dia';
  perform mayara.proposta_lembrete_registrar((j ->> 'proposta_id')::bigint, 2, false, 'erro');
  perform mayara.proposta_lembrete_registrar((j ->> 'proposta_id')::bigint, 2, false, 'erro');
  perform mayara.proposta_lembrete_registrar((j ->> 'proposta_id')::bigint, 2, false, 'erro');
  update mayara.proposta_enviada set ultima_falha_em = seg + interval '1 day' + interval '2 hours 45 minutes' where id = (j ->> 'proposta_id')::bigint;
  assert not coalesce((mayara.proposta_proximo_lembrete(seg + interval '1 day' + interval '3 hours') ->> 'enviar')::boolean, false), 'depois de 3 falhas na hora, pausa';

  -- nome que nao e de pessoa: texto sem nome
  perform mayara.registrar_proposta('+5511999991002', null, hoje, 'adm');
  assert mayara.proposta_texto(1, 'Darpex Darpex') like 'Olá. Aqui é a Mayara%', 'texto sem nome para nome de empresa';

  -- resposta do lead: marca, alerta uma vez e para os lembretes
  update mayara.proposta_enviada set criado_em = now() - interval '1 day' where telefone_chave = k2 and estado = 'ativa';
  insert into mayara.canal_eventos (canal_id, provedor, resultado, remetente_chave, tipo, criado_em) values ('escritorio', 'evolution', 'aceito', k2, 'text', now());
  select count(*) into n from mayara.proposta_respostas_novas();
  assert n = 1, 'uma resposta nova: ' || n;
  assert (select estado from mayara.proposta_enviada where telefone_chave = k2 and respondeu_em is not null limit 1) = 'respondeu', 'estado respondeu';
  assert (select count(*) from mayara.proposta_respostas_novas()) = 0, 'o alerta sai uma vez so';
  assert not exists (select 1 from mayara.proposta_enviada where telefone_chave = k2 and estado = 'ativa'), 'respondeu: nao recebe mais lembrete';
  -- resposta antiga (antes do registro) nao conta
  perform mayara.registrar_proposta('+5511999991004', null, hoje, 'adm');
  assert (select count(*) from mayara.proposta_respostas_novas() where fim = '1004') = 0, 'sem resposta depois do registro: sem alerta';

  -- contrato e sem_interesse encerram
  update mayara.proposta_enviada set enviada_em = date '2026-12-01' where telefone_chave = k4 and estado = 'ativa';
  perform painel.contrato_registrar('+5511999991004', 'Dina', null, 500, hoje, jsonb_build_array(jsonb_build_object('numero', 1, 'valor', 500, 'vencimento', hoje + 30)));
  perform mayara.proposta_proximo_lembrete(seg);
  assert (select motivo from mayara.proposta_enviada where telefone_chave = k4 order by id desc limit 1) = 'contrato', 'contrato encerra a proposta';

  -- ultima etapa encerra
  update mayara.proposta_enviada set etapa_atual = 3 where telefone_chave = k1 and estado = 'ativa';
  select id into pid from mayara.proposta_enviada where telefone_chave = k1 and estado = 'ativa';
  perform mayara.proposta_lembrete_registrar(pid, 4, true, null);
  assert (select motivo from mayara.proposta_enviada where id = pid) = 'sequencia_concluida' and (select estado from mayara.proposta_enviada where id = pid) = 'encerrada', 'o 4o lembrete conclui a sequencia';

  assert not has_function_privilege('anon', 'mayara.registrar_proposta(text, text, date, text)', 'execute'), 'anon sem execute';
  assert not has_function_privilege('authenticated', 'mayara.proposta_proximo_lembrete(timestamptz)', 'execute'), 'authenticated sem execute';
end $t$;
rollback;
select 'OK 0081' as resultado;
