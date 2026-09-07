-- supabase/migrations/0002_mayara_crm_retry_queue.sql
select pgmq.create('mayara_crm_retry');
