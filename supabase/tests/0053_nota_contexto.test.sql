-- supabase/tests/0053_nota_contexto.test.sql
-- A versao de texto livre foi substituida na migration 0054 (ver 0054_nota_contexto_segura.test.sql).
begin;
do $t$
begin
  assert mayara.registrar_nota_contexto('+5551999990801', 'qualquer texto livre') = false, 'texto livre desativado';
  assert not has_function_privilege('anon', 'mayara.registrar_nota_contexto(text,text)', 'execute'), 'anon sem execute';
end $t$;
rollback;
select 'OK 0053';
