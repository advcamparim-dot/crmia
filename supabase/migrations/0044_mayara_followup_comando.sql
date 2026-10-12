-- Follow-up: so reserva com o canal aberto; comando /followup da Central.

-- 1) a regua nao reserva nada enquanto o canal do escritorio nao estiver aberto
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
  if v_modo = 'ligado' and coalesce((select ce.estado from mayara.canal_estado ce where ce.canal_id = 'escritorio'), 'open') <> 'open' then
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

-- 2) texto de status do follow-up
create or replace function mayara._followup_status_texto()
returns text language plpgsql stable set search_path = '' as $$
declare
  v_modo text := coalesce((select valor from mayara.config where chave = 'followup_modo'), 'desligado');
  v_canal text := coalesce((select ce.estado from mayara.canal_estado ce where ce.canal_id = 'escritorio'), 'desconhecido');
  v_hoje timestamptz := date_trunc('day', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo';
  v_prox text;
  v_rev text;
  v_env int; v_sim int;
begin
  select count(*) filter (where estado = 'enviado'), count(*) filter (where estado = 'simulado')
    into v_env, v_sim from mayara.followups_log where criado_em >= v_hoje;
  select string_agg('- ' || e.lead_nome || ' (etapa ' || e.lead_etapa || ', ' || to_char(e.lead_devido at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI') || ')', E'\n' order by e.lead_devido)
    into v_prox from (select * from mayara.followups_elegiveis(now()) order by lead_devido limit 8) e;
  select string_agg('- ' || coalesce((select la.nome from mayara.leads_autorizados la where la.telefone_chave = fe.chave limit 1), 'lead') || ' (final ' || right(fe.chave, 4) || ')', E'\n')
    into v_rev from mayara.followup_estado fe where fe.status = 'revisao_humana';
  return 'Follow-up: ' || v_modo || E'\n'
    || 'Canal do WhatsApp: ' || v_canal || E'\n'
    || 'Janela de envio agora: ' || case when mayara.followup_permitido(now()) then 'aberta' else 'fechada (abre ' || to_char(mayara.proxima_abertura(now(), 'followup') at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI') || ')' end || E'\n'
    || 'Hoje: ' || v_env || ' enviados, ' || v_sim || E' simulados\n'
    || 'Fila (elegíveis agora ou já devidos):' || E'\n' || coalesce(v_prox, '- ninguém') || E'\n'
    || 'Em revisão humana:' || E'\n' || coalesce(v_rev, '- ninguém');
end $$;

-- 3) comando /followup
create or replace function mayara.comando_followup(p_args text)
returns text language plpgsql set search_path = '' as $$
declare
  v_args text := btrim(coalesce(p_args, ''));
  v_cmd text := lower(split_part(btrim(coalesce(p_args, '')), ' ', 1));
  v_resto text;
  v_novo text;
  v_atual text;
  v_chave text;
  v_nome text;
  v_lista jsonb;
  v_n int;
begin
  v_resto := btrim(substr(v_args, length(split_part(v_args, ' ', 1)) + 1));
  if v_cmd in ('', 'status') then
    return mayara._followup_status_texto();
  end if;
  if v_cmd = 'modo' then
    v_novo := lower(v_resto);
    if v_novo not in ('desligado', 'simulacao', 'simulação', 'ligado') then
      return 'Use /followup modo desligado, simulacao ou ligado.';
    end if;
    v_novo := replace(v_novo, 'simulação', 'simulacao');
    v_atual := coalesce((select valor from mayara.config where chave = 'followup_modo'), 'desligado');
    if v_atual = 'simulacao' and v_novo = 'ligado' then
      perform mayara.reiniciar_simulacao();
    end if;
    update mayara.config set valor = v_novo where chave = 'followup_modo';
    return 'Follow-up agora está ' || v_novo || '. '
      || case v_novo when 'ligado' then 'Os envios seguem o expediente e o limite por hora.'
                     when 'simulacao' then 'A régua gera e registra os textos, mas não envia nada.'
                     else 'Nenhum follow-up será reservado nem enviado.' end;
  end if;
  if v_cmd in ('retomar', 'encerrar') then
    if v_resto = '' then
      return 'Diga o lead: /followup ' || v_cmd || ' +5514999990000 ou o nome.';
    end if;
    v_chave := mayara.chave_telefone(v_resto);
    if v_chave is null then
      v_lista := mayara.buscar_leads_por_nome(v_resto);
      v_n := jsonb_array_length(v_lista);
      if v_n = 0 then
        return 'Não achei lead com "' || left(v_resto, 40) || '". Use o telefone com DDD.';
      elsif v_n > 1 then
        return 'Achei ' || v_n::text || ' leads parecidos; use o telefone com DDD: /followup ' || v_cmd || ' +5514999990000';
      end if;
      v_chave := mayara.chave_telefone(v_lista -> 0 ->> 'telefone');
    end if;
    select la.nome into v_nome from mayara.leads_autorizados la where la.telefone_chave = v_chave;
    if v_nome is null then
      return 'Esse número não está na lista de leads da Mayara.';
    end if;
    insert into mayara.followup_estado (chave, status, enviados_total)
    values (v_chave, case v_cmd when 'retomar' then 'ativo' else 'encerrado' end, 0)
    on conflict (chave) do update
       set status = case v_cmd when 'retomar' then 'ativo' else 'encerrado' end,
           enviados_total = case v_cmd when 'retomar' then 0 else mayara.followup_estado.enviados_total end,
           pausado_ate = null,
           atualizado_em = now();
    return case v_cmd when 'retomar' then 'Retomei o follow-up de ' || v_nome || ' (final ' || right(v_chave, 4) || '). O contador de envios recomeçou.'
                      else 'Encerrei o follow-up de ' || v_nome || ' (final ' || right(v_chave, 4) || '). Nenhum novo follow-up automático.' end;
  end if;
  return 'Use: /followup status, /followup modo desligado|simulacao|ligado, /followup retomar <lead> ou /followup encerrar <lead>.';
end $$;

create or replace function mayara.executar_central(p_fn text, p_arg text, p_arg2 text, p_autor text)
returns text language plpgsql set search_path = '' as $$
begin
  return case p_fn
    when 'status' then mayara.status_resumo()
    when 'regras' then mayara.regras_texto()
    when 'assumir' then mayara.assumir_lead(p_arg)
    when 'devolver' then mayara.devolver_lead(p_arg)
    when 'desfazer' then case when p_arg ~ '^[0-9]{1,9}$'
                              then mayara.desfazer_instrucao(p_arg::bigint)
                              else 'Use /desfazer <número>. Veja os números em /regras.' end
    when 'reativar' then case when p_arg ~ '^[0-9]{1,9}$'
                              then mayara.reativar_instrucao(p_arg::bigint)
                              else 'Use /reativar <número>.' end
    when 'confirmar_sim' then mayara.confirmar_pendente('sim')
    when 'confirmar_nao' then mayara.confirmar_pendente('nao')
    when 'criar_pendente' then mayara.criar_pendente(p_arg, p_arg2, p_autor)
    when 'followup' then mayara.comando_followup(p_arg)
    else 'Comando não reconhecido. Envie /ajuda.'
  end;
end $$;

revoke all on function mayara.reservar_followups(timestamptz, int) from public, anon, authenticated;
revoke all on function mayara._followup_status_texto() from public, anon, authenticated;
revoke all on function mayara.comando_followup(text) from public, anon, authenticated;
revoke all on function mayara.executar_central(text, text, text, text) from public, anon, authenticated;
