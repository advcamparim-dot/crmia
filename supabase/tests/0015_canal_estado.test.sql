-- supabase/tests/0015_canal_estado.test.sql
-- Rodar inteiro (execute_sql). Dados ficticios; termina em rollback.
begin;

do $t$
declare r jsonb;
begin
  -- primeira vez que vemos o canal conectado: registra, nao alerta
  r := mayara.registrar_estado_canal('t-estado', 'open');
  assert (r ->> 'alertar') = 'false' and (r ->> 'anterior') is null, 'primeiro open nao alerta: ' || r::text;

  -- oscilacao connecting nao alerta
  r := mayara.registrar_estado_canal('t-estado', 'connecting');
  assert (r ->> 'alertar') = 'false', 'connecting nao alerta: ' || r::text;

  -- queda: alerta uma vez
  r := mayara.registrar_estado_canal('t-estado', 'close');
  assert (r ->> 'alertar') = 'true' and (r ->> 'anterior') = 'connecting', 'close alerta: ' || r::text;

  -- repeticao de close nao alerta de novo
  r := mayara.registrar_estado_canal('t-estado', 'close');
  assert (r ->> 'alertar') = 'false', 'close repetido nao alerta: ' || r::text;

  -- volta a conectar: marca recuperado
  r := mayara.registrar_estado_canal('t-estado', 'open');
  assert (r ->> 'recuperado') = 'true' and (r ->> 'alertar') = 'false', 'open apos close recupera: ' || r::text;

  -- nova queda logo em seguida (dentro de 10 min) nao realerta; fora dos 10 min realerta
  r := mayara.registrar_estado_canal('t-estado', 'close');
  assert (r ->> 'alertar') = 'false', 'queda dentro de 10 min nao realerta: ' || r::text;
  update mayara.canal_estado set alertado_em = now() - interval '11 minutes' where canal_id = 't-estado';
  r := mayara.registrar_estado_canal('t-estado', 'open');
  r := mayara.registrar_estado_canal('t-estado', 'close');
  assert (r ->> 'alertar') = 'true', 'queda apos 10 min realerta: ' || r::text;

  -- estado desconhecido e normalizado e nunca alerta
  r := mayara.registrar_estado_canal('t-estado', 'QualquerCoisa');
  assert (r ->> 'estado') = 'desconhecido' and (r ->> 'alertar') = 'false', 'estado desconhecido: ' || r::text;
  r := mayara.registrar_estado_canal('t-estado', 'CLOSE');
  assert (r ->> 'estado') = 'close', 'normaliza caixa: ' || r::text;

  -- origem no log de envios (funcao antiga de 4 argumentos continua valendo)
  perform mayara.registrar_envio('t-estado', '5511999990501', 'texto', '{"ok":true,"messages":[{"id":"x1"}]}'::jsonb);
  perform mayara.registrar_envio('t-estado', '5511999990502', 'texto', '{"ok":true,"messages":[{"id":"x2"}]}'::jsonb, 'ponte');
  assert (select origem from mayara.envios_log where provedor_message_id = 'x2') = 'ponte', 'grava a origem';
  assert (select origem from mayara.envios_log where provedor_message_id = 'x1') is null, 'origem opcional';

  -- retencao: remove so o que passou do prazo
  insert into mayara.canal_eventos (canal_id, provedor, resultado, motivo, criado_em) values
    ('t-estado', 'evolution', 'descartado', 'grupo', now() - interval '91 days'),
    ('t-estado', 'evolution', 'descartado', 'grupo', now() - interval '5 days');
  assert mayara.limpar_eventos_canal(90) = 1, 'remove 1 evento antigo';
  assert (select count(*) from mayara.canal_eventos where canal_id = 't-estado') = 1, 'mantem o recente';

  -- acesso fechado
  assert not has_table_privilege('anon', 'mayara.canal_estado', 'select'), 'anon sem select';
  assert not has_function_privilege('authenticated', 'mayara.registrar_estado_canal(text,text)', 'execute'), 'authenticated sem execute';
  assert not has_function_privilege('anon', 'mayara.limpar_eventos_canal(int)', 'execute'), 'anon sem execute (limpar)';
end $t$;

rollback;
select 'OK 0015' as resultado;
