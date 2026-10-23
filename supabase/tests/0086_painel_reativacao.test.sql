begin;
do $$
declare r record;
begin
  select * into r from painel.reativacao_resumo();
  assert r.leads is not null and r.leads >= 0, 'devolve uma linha';
  assert r.abordados <= r.leads, 'abordados nao passa do total';
  assert r.responderam <= r.abordados, 'quem respondeu foi abordado';
  assert r.em_conversa + r.com_equipe + r.sem_interesse <= r.responderam, 'categorias cabem em responderam';
  assert r.restantes + r.abordados <= r.leads, 'restantes + abordados cabem no total';
end $$;
select 'OK 0086';
rollback;
