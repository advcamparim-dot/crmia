-- supabase/tests/0019_canal_estado_queda_continua.test.sql
-- Rodar inteiro (execute_sql). Dados ficticios; termina em rollback.
begin;

do $t$
declare r jsonb;
begin
  r := mayara.registrar_estado_canal('t-queda', 'open');
  r := mayara.registrar_estado_canal('t-queda', 'close');
  assert (r ->> 'alertar') = 'true', 'primeira queda alerta: ' || r::text;

  -- queda continua: a Evolution fica alternando close/connecting; nunca realerta, mesmo apos 10 min
  -- dentro da transacao now() e constante: retroage o alerta e o open juntos (o open veio antes do alerta)
  update mayara.canal_estado set alertado_em = now() - interval '11 minutes', ultimo_open_em = now() - interval '12 minutes' where canal_id = 't-queda';
  r := mayara.registrar_estado_canal('t-queda', 'connecting');
  r := mayara.registrar_estado_canal('t-queda', 'close');
  assert (r ->> 'alertar') = 'false', 'queda continua nao realerta: ' || r::text;
  update mayara.canal_estado set alertado_em = now() - interval '25 minutes', ultimo_open_em = now() - interval '26 minutes' where canal_id = 't-queda';
  r := mayara.registrar_estado_canal('t-queda', 'connecting');
  r := mayara.registrar_estado_canal('t-queda', 'close');
  assert (r ->> 'alertar') = 'false', 'queda continua nao realerta (2): ' || r::text;

  -- recuperou e caiu de novo (fora dos 10 min): alerta
  r := mayara.registrar_estado_canal('t-queda', 'open');
  assert (r ->> 'recuperado') = 'true', 'recupera: ' || r::text;
  update mayara.canal_estado set alertado_em = now() - interval '11 minutes' where canal_id = 't-queda';
  r := mayara.registrar_estado_canal('t-queda', 'close');
  assert (r ->> 'alertar') = 'true', 'nova queda apos recuperar alerta: ' || r::text;

  -- recuperou e caiu de novo dentro dos 10 min: nao alerta (oscilacao)
  r := mayara.registrar_estado_canal('t-queda', 'open');
  r := mayara.registrar_estado_canal('t-queda', 'close');
  assert (r ->> 'alertar') = 'false', 'oscilacao dentro de 10 min nao alerta: ' || r::text;
end $t$;

rollback;
select 'OK 0019' as resultado;
