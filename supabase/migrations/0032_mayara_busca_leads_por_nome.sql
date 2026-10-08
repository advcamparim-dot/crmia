-- supabase/migrations/0032_mayara_busca_leads_por_nome.sql
alter table crm_sync.leads add column phone text;

create or replace function mayara._sem_acento(p_texto text)
returns text language sql immutable set search_path = '' as $$
  select lower(translate(coalesce(p_texto, ''), 'ÁÀÂÃÄáàâãäÉÈÊËéèêëÍÌÎÏíìîïÓÒÔÕÖóòôõöÚÙÛÜúùûüÇçÑñ', 'AAAAAaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuCcNn'))
$$;

create or replace function mayara.buscar_leads_por_nome(p_nome text)
returns jsonb language plpgsql stable set search_path = '' as $$
declare
  v_busca text := btrim(mayara._sem_acento(p_nome));
  r jsonb;
begin
  if char_length(v_busca) < 3 then
    return '[]'::jsonb;
  end if;
  with lista as (
    select l.nome, l.telefone, l.telefone_chave as chave, l.status, l.espocrm_lead_id as crm_id,
           exists (select 1 from crm_sync.leads c
                   where c.id = l.espocrm_lead_id
                      or (c.phone is not null and mayara.chave_telefone(c.phone) = l.telefone_chave)) as no_crm
    from mayara.leads_autorizados l
    where mayara._sem_acento(l.nome) like '%' || v_busca || '%'
  ), so_crm as (
    select c.name as nome, c.phone as telefone, mayara.chave_telefone(c.phone) as chave,
           'fora_da_lista'::text as status, c.id as crm_id, false as no_crm
    from crm_sync.leads c
    where mayara._sem_acento(c.name) like '%' || v_busca || '%'
      and not exists (select 1 from mayara.leads_autorizados l
                      where l.espocrm_lead_id = c.id
                         or (c.phone is not null and l.telefone_chave = mayara.chave_telefone(c.phone)))
  ), uniao as (
    select nome, telefone, chave, status, crm_id,
           case when no_crm then 'lista_e_crm' else 'lista' end as origem
      from lista
    union all
    select nome, telefone, chave, status, crm_id, 'crm' from so_crm
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'nome', nome, 'fim', right(coalesce(chave, ''), 4), 'status', status,
           'origem', origem, 'telefone', telefone, 'crm_lead_id', crm_id) order by nome), '[]'::jsonb)
    into r from (select * from uniao order by nome limit 10) x;
  return r;
end $$;

revoke all on function mayara._sem_acento(text) from public, anon, authenticated;
revoke all on function mayara.buscar_leads_por_nome(text) from public, anon, authenticated;
