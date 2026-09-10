-- supabase/migrations/0004_mayara_followup_funil.sql
-- Campos para o funil de follow-up de leads silenciosos (ver
-- docs/superpowers/specs/2026-09-10-mayara-followup-funil-design.md).

alter table mayara.session_state
  add column if not exists last_lead_message_at timestamptz,
  add column if not exists phone text,
  add column if not exists phone_number_id text,
  add column if not exists follow_up_status text not null default 'ativo',
  add column if not exists follow_up_stage text not null default 'nenhum',
  add column if not exists follow_up_last_sent_at timestamptz,
  add column if not exists follow_up_tentativas int not null default 0;

alter table mayara.session_state
  add constraint chk_follow_up_status
    check (follow_up_status in ('ativo','resolvido_continua','resolvido_sem_interesse','pausado_humano','excluido_seguranca','dormente'));

alter table mayara.session_state
  add constraint chk_follow_up_stage
    check (follow_up_stage in ('nenhum','ia_sumiu_meio','template1','template2'));

-- Índice parcial: só indexa linhas realmente elegíveis pro worker de follow-up,
-- mantém o índice pequeno mesmo com muitos leads já resolvidos.
create index if not exists idx_session_state_followup
  on mayara.session_state (follow_up_status, last_lead_message_at)
  where follow_up_status = 'ativo';

-- Necessário porque o registro determinístico de "última mensagem do lead"
-- (ver Núcleo, node "Registrar Ultima Mensagem do Lead") pode inserir a
-- linha antes do AI Agent decidir o estado real da conversa.
alter table mayara.session_state alter column estado set default 'S0_NOVO';
