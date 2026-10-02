-- supabase/migrations/0009_mayara_chat_memoria.sql
-- Memoria de conversa da Mayara (node Postgres Chat Memory do n8n, typeVersion 1.4).
-- O node so aceita o nome da tabela (sem schema), entao ela fica em public.
-- Por isso: RLS ligada, sem policies e sem grants para anon/authenticated,
-- o que a torna inacessivel pela API do Supabase. So a credencial Postgres do n8n acessa.
-- Colunas id, session_id e message sao as que o node espera; created_at e extra (retencao).

create table if not exists public.n8n_chat_histories (
  id serial primary key,
  session_id varchar(255) not null,
  message jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists n8n_chat_histories_session_idx
  on public.n8n_chat_histories (session_id, id);
create index if not exists n8n_chat_histories_created_idx
  on public.n8n_chat_histories (created_at);

alter table public.n8n_chat_histories enable row level security;
revoke all on public.n8n_chat_histories from anon, authenticated;
revoke all on sequence public.n8n_chat_histories_id_seq from anon, authenticated;

-- Retencao: apaga mensagens com mais de 30 dias. Agendar em workflow do n8n.
create or replace function mayara.limpar_chat_memoria(p_dias int default 30)
returns int
language plpgsql
set search_path = ''
as $$
declare v_n int;
begin
  delete from public.n8n_chat_histories where created_at < now() - make_interval(days => p_dias);
  get diagnostics v_n = row_count;
  return v_n;
end $$;

revoke all on function mayara.limpar_chat_memoria(int) from public, anon, authenticated;
