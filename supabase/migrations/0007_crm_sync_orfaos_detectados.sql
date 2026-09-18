-- supabase/migrations/0007_crm_sync_orfaos_detectados.sql
-- Esta tabela já está aplicada em produção (migração remota
-- 20260917100950 "create_crm_sync_orfaos_detectados") mas nunca tinha
-- sido versionada neste repositório — recuperando o arquivo aqui para
-- que o histórico de migrations reflita o schema real do banco.
--
-- Nota: em produção esta tabela foi criada originalmente SEM RLS habilitada,
-- quebrando o padrão do restante do schema crm_sync (todas as outras tabelas
-- têm RLS ligada, ver 0003_painel_executivo_schema.sql). O `enable row level
-- security` abaixo já foi aplicado também em produção (18/09/2026) — arquivo
-- e banco real estão consistentes agora.
create table if not exists crm_sync.orfaos_detectados (
  id bigint generated always as identity primary key,
  entity_name text not null,
  record_id text not null,
  detected_at timestamptz not null default now(),
  resolved boolean not null default false,
  resolved_at timestamptz,
  unique (entity_name, record_id)
);

comment on table crm_sync.orfaos_detectados is 'Registros presentes no espelho crm_sync.* mas ausentes no EspoCRM (provavel exclusao na origem). Requer limpeza manual — o sync nao apaga automaticamente.';

alter table crm_sync.orfaos_detectados enable row level security;
