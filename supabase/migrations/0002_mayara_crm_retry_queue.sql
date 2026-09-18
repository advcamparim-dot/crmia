-- supabase/migrations/0002_mayara_crm_retry_queue.sql
-- A extensão pgmq já foi habilitada em produção via migração separada
-- (20260907081752 "enable_pgmq") que nunca foi versionada neste repositório.
-- Sem esta linha, aplicar estes arquivos do zero (ex.: supabase db reset,
-- branch nova) falha em "schema pgmq does not exist".
create extension if not exists pgmq;

select pgmq.create('mayara_crm_retry');
