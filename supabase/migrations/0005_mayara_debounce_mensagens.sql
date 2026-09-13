-- supabase/migrations/0005_mayara_debounce_mensagens.sql
-- Buffer de mensagens pra "debounce" na Ponte WhatsApp: quando o lead manda
-- várias mensagens em sequência, a Mayara espera e responde uma vez só,
-- combinando todas, em vez de responder mensagem por mensagem.
-- Ver docs/superpowers/specs/2026-09-13-mayara-debounce-mensagens-design.md

create table mayara.mensagens_buffer (
  id bigserial primary key,
  session_key text not null,
  mensagem text not null,
  recebido_em timestamptz not null default now(),
  processado boolean not null default false
);

create index idx_mensagens_buffer_pendentes
  on mayara.mensagens_buffer (session_key, recebido_em)
  where not processado;

alter table mayara.mensagens_buffer enable row level security;
