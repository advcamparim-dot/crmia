-- supabase/migrations/0006_mayara_lembretes_consulta.sql
alter table mayara.session_state
  add column if not exists consulta_agendada_em timestamptz,
  add column if not exists lembrete_consulta_estagio text not null default 'nenhum';

alter table mayara.session_state
  add constraint lembrete_consulta_estagio_check
  check (lembrete_consulta_estagio in ('nenhum', '1dia', '1h', '15min'));

alter table mayara.session_state
  drop constraint if exists chk_follow_up_status;

alter table mayara.session_state
  add constraint chk_follow_up_status
  check (follow_up_status in (
    'ativo', 'resolvido_continua', 'resolvido_sem_interesse',
    'pausado_humano', 'excluido_seguranca', 'dormente', 'transferido_consulta'
  ));

create index if not exists idx_session_state_lembretes
  on mayara.session_state (consulta_agendada_em)
  where estado = 'S6_AGENDADO' and lembrete_consulta_estagio <> '15min';
