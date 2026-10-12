-- Liberacao explicita, pelo administrador, de um lead em prioridade juridica para a regua de follow-up.
alter table mayara.followup_estado add column liberar_prioridade_juridica boolean not null default false;

create or replace function mayara._lead_excluido(p_chave text, p_agora timestamptz default now())
returns text language plpgsql stable set search_path = '' as $$
declare fe mayara.followup_estado%rowtype;
begin
  if not exists (select 1 from mayara.leads_autorizados la where la.telefone_chave = p_chave and la.status = 'ativo') then
    return 'lead_inativo';
  end if;
  if exists (select 1 from mayara.administradores a where a.telefone_chave = p_chave) then
    return 'administrador';
  end if;
  -- agendado ou com a equipe: sempre fora, mesmo com liberacao
  if exists (select 1 from mayara.session_state s
              where mayara.chave_telefone(s.phone) = p_chave
                and (s.estado in ('S6_AGENDADO', 'S7_HANDOFF_HUMANO') or s.consulta_agendada_em is not null)) then
    return 'excluido_seguranca';
  end if;
  select * into fe from mayara.followup_estado where chave = p_chave;
  -- prioridade juridica / situacao sensivel: fora, salvo liberacao explicita do administrador
  if not coalesce(fe.liberar_prioridade_juridica, false)
     and exists (select 1 from mayara.session_state s
                  where mayara.chave_telefone(s.phone) = p_chave
                    and (s.estado = 'S3_PRIORIDADE_JURIDICA'
                         or coalesce(s.fatos_json ->> 'situacaoJudicial', 'nenhuma') in
                            ('execucao', 'execução', 'recuperacao_judicial', 'recuperação_judicial', 'falencia', 'falência'))) then
    return 'excluido_seguranca';
  end if;
  if found then
    if fe.status <> 'ativo' then
      return fe.status;
    end if;
    if fe.pausado_ate is not null and fe.pausado_ate > p_agora then
      return 'pausado';
    end if;
  end if;
  return null;
end $$;

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
  if v_cmd in ('retomar', 'encerrar', 'liberar') then
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
    if v_cmd = 'liberar' then
      insert into mayara.followup_estado (chave, liberar_prioridade_juridica) values (v_chave, true)
      on conflict (chave) do update set liberar_prioridade_juridica = true, atualizado_em = now();
      return 'Liberei o follow-up de ' || v_nome || ' (final ' || right(v_chave, 4) || ') mesmo com prioridade jurídica. Vale só para esse lead e continua respeitando consulta agendada e atendimento da equipe.';
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
  return 'Use: /followup status, /followup modo desligado|simulacao|ligado, /followup retomar <lead>, /followup encerrar <lead> ou /followup liberar <lead>.';
end $$;

revoke all on function mayara._lead_excluido(text, timestamptz) from public, anon, authenticated;
revoke all on function mayara.comando_followup(text) from public, anon, authenticated;
