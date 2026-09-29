-- supabase/tests/0008_sem_interesse.test.sql
-- Rodar inteiro (execute_sql). Usa so numeros ficticios; termina em rollback.
-- A query preparada abaixo e a da ferramenta "Marcar Sem Interesse" (workflow aULd8QZQ3OVFhoRg).
begin;

prepare marcar_sem_interesse(text) as
with s as (
  update mayara.session_state set follow_up_status = 'resolvido_sem_interesse' where session_key = $1 returning session_key
)
update mayara.leads_autorizados set status = 'sem_interesse'
where telefone_chave = mayara.chave_telefone(split_part($1, ':', 3)) and status = 'ativo';

select mayara.upsert_lead_autorizado('+5511999990020','T',null,null,'teste',null,'{}'::jsonb);
select mayara.upsert_lead_autorizado('+5511999990021','B',null,null,'teste',null,'{}'::jsonb);
update mayara.leads_autorizados set status = 'bloqueado' where telefone = '+5511999990021';
insert into mayara.session_state (session_key) values ('whatsapp:1365007506685934:+5511999990020');
insert into mayara.session_state (session_key) values ('whatsapp:1365007506685934:+5511999990021');

execute marcar_sem_interesse('whatsapp:1365007506685934:+5511999990020');
execute marcar_sem_interesse('whatsapp:1365007506685934:+5511999990021');

do $$
begin
  assert (select status from mayara.leads_autorizados where telefone = '+5511999990020') = 'sem_interesse', 'lead ativo virou sem_interesse';
  assert (select follow_up_status from mayara.session_state where session_key = 'whatsapp:1365007506685934:+5511999990020') = 'resolvido_sem_interesse', 'sessao marcada como antes';
  assert (select status from mayara.leads_autorizados where telefone = '+5511999990021') = 'bloqueado', 'bloqueado nao muda';
  assert (select follow_up_status from mayara.session_state where session_key = 'whatsapp:1365007506685934:+5511999990021') = 'resolvido_sem_interesse', 'sessao do bloqueado marcada como antes';
end $$;

rollback;
