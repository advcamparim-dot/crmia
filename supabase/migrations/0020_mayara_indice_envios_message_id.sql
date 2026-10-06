-- supabase/migrations/0020_mayara_indice_envios_message_id.sql
-- mayara.humano_assumiu consulta envios_log por provedor_message_id a cada mensagem enviada pelo numero do escritorio.
create index envios_log_provedor_message_id_idx on mayara.envios_log (provedor_message_id) where provedor_message_id is not null;
