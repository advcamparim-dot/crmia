-- supabase/tests/0014_admin_fora_da_janela.test.sql
-- Rodar inteiro (execute_sql). Numeros ficticios; termina em rollback.
begin;
-- janela de 48 h ligada para este teste (a janela pode estar desligada com evolution_janela_horas = 0)
update mayara.config set valor = '48' where chave = 'evolution_janela_horas';

insert into mayara.canais (canal_id, provedor, rotulo) values ('t-evo14', 'evolution', 'Teste Evolution 14');
insert into mayara.administradores (telefone, nome, ativo) values
  ('+5511999990401', 'Admin ativo', true),
  ('+5511999990402', 'Admin inativo', false);

do $t$
declare r jsonb;
begin
  r := mayara.pode_enviar('t-evo14', '5511999990401', 'texto');
  assert (r ->> 'ok') = 'true' and (r ->> 'provedor') = 'evolution', 'admin ativo envia sem conversa recente: ' || r::text;

  r := mayara.pode_enviar('t-evo14', '5511999990402', 'texto');
  assert (r ->> 'motivo') = 'fora_da_janela', 'admin inativo continua sujeito a janela: ' || r::text;

  r := mayara.pode_enviar('t-evo14', '5511999990499', 'texto');
  assert (r ->> 'motivo') = 'fora_da_janela', 'quem nao e admin continua sujeito a janela: ' || r::text;

  r := mayara.pode_enviar('t-evo14', '123', 'texto');
  assert (r ->> 'motivo') = 'destino_invalido', 'destino invalido continua recusado: ' || r::text;

  update mayara.canais set ativo = false where canal_id = 't-evo14';
  r := mayara.pode_enviar('t-evo14', '5511999990401', 'texto');
  assert (r ->> 'motivo') = 'canal_inativo', 'canal inativo recusa ate o admin: ' || r::text;
end $t$;

rollback;
select 'OK 0014' as resultado;
