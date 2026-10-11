-- Relogio de teste da regua: quando 'followup_relogio_teste' tem um horario, a reserva e a revalidacao
-- usam esse horario no lugar de agora. Vazio por padrao; serve para ensaiar a regua sem enviar nada.
insert into mayara.config (chave, valor) values ('followup_relogio_teste', '') on conflict (chave) do nothing;

create or replace function mayara._relogio(p_agora timestamptz)
returns timestamptz language sql stable set search_path = '' as $$
  select coalesce(nullif((select valor from mayara.config where chave = 'followup_relogio_teste'), '')::timestamptz, p_agora)
$$;

create or replace function mayara.reservar_followups(p_agora timestamptz default now(), p_limite int default 5)
returns table (log_id bigint, lead_chave text, lead_sequencia text, lead_etapa int, lead_ciclo timestamptz,
               lead_nome text, lead_telefone text, modo text, texto_proximo text)
language plpgsql set search_path = '' as $$
#variable_conflict use_column
declare
  v_agora timestamptz := mayara._relogio(p_agora);
  v_modo text := coalesce((select valor from mayara.config where chave = 'followup_modo'), 'desligado');
  v_quota int;
  v_n int;
begin
  if v_modo not in ('simulacao', 'ligado') then
    return;
  end if;
  if not mayara.followup_permitido(v_agora) then
    return;
  end if;
  v_quota := coalesce((select valor::int from mayara.config where chave = 'followup_limite_hora'), 15)
           - (select count(*) from mayara.followups_log f
               where f.estado in ('enviado', 'simulado', 'reservado') and f.criado_em > v_agora - interval '1 hour');
  v_n := least(p_limite, v_quota);
  if v_n <= 0 then
    return;
  end if;
  return query
  with e as (
    select x.* from mayara.followups_elegiveis(v_agora) x
     where not exists (select 1 from mayara.followups_log f
                        where f.chave = x.lead_chave and f.ciclo_saida = x.lead_ciclo and f.etapa = x.lead_etapa and f.estado = 'falhou'
                       having count(*) >= 3)
     order by x.lead_devido, x.lead_chave
     limit v_n
  ), ins as (
    insert into mayara.followups_log (chave, sequencia, etapa, estado, ciclo_saida)
    select e.lead_chave, e.lead_sequencia, e.lead_etapa, 'reservado', e.lead_ciclo from e
    on conflict (chave) where estado = 'reservado' do nothing
    returning id, chave, sequencia, etapa, ciclo_saida
  )
  select ins.id, ins.chave, ins.sequencia, ins.etapa, ins.ciclo_saida, e.lead_nome, e.lead_telefone, v_modo,
         (select fe.texto_proximo from mayara.followup_estado fe where fe.chave = ins.chave and fe.ciclo_saida = ins.ciclo_saida)
    from ins join e on e.lead_chave = ins.chave;
end $$;

create or replace function mayara.followup_ainda_valido(p_log_id bigint, p_agora timestamptz default now())
returns jsonb language plpgsql stable set search_path = '' as $$
declare f mayara.followups_log%rowtype; v_exc text; v_entrada timestamptz; v_agora timestamptz := mayara._relogio(p_agora);
begin
  select * into f from mayara.followups_log where id = p_log_id and estado = 'reservado';
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'reserva_invalida');
  end if;
  if not mayara.followup_permitido(v_agora) then
    return jsonb_build_object('ok', false, 'motivo', 'fora_janela');
  end if;
  v_exc := mayara._lead_excluido(f.chave, v_agora);
  if v_exc is not null then
    return jsonb_build_object('ok', false, 'motivo', v_exc);
  end if;
  v_entrada := mayara._ultima_entrada(f.chave);
  if v_entrada is not null and v_entrada > f.ciclo_saida then
    return jsonb_build_object('ok', false, 'motivo', 'respondeu');
  end if;
  if mayara._ultima_saida(f.chave) is distinct from f.ciclo_saida then
    return jsonb_build_object('ok', false, 'motivo', 'novo_ciclo');
  end if;
  return jsonb_build_object('ok', true);
end $$;

revoke all on function mayara._relogio(timestamptz) from public, anon, authenticated;
revoke all on function mayara.reservar_followups(timestamptz, int) from public, anon, authenticated;
revoke all on function mayara.followup_ainda_valido(bigint, timestamptz) from public, anon, authenticated;
