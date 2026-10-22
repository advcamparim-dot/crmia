-- Acao "proposta_enviada" na Central: registra a proposta (lead bloqueado + lembretes) depois do "sim". Chave proposta_comando (padrao desligado).
insert into mayara.config (chave, valor) values ('proposta_comando', 'desligado') on conflict (chave) do nothing;

alter table mayara.acoes_pendentes drop constraint acoes_pendentes_acao_check;
alter table mayara.acoes_pendentes add constraint acoes_pendentes_acao_check
  check (acao in ('pausar', 'ligar', 'assumir', 'devolver', 'desfazer_regra', 'reativar_regra', 'abordar', 'registrar_contrato', 'proposta_enviada'));

create or replace function mayara.criar_acao_pendente(p_acao text, p_argumentos jsonb, p_resumo text, p_autor text)
returns text language plpgsql set search_path = '' as $$
declare
  v_pend text;
  v_args jsonb := coalesce(p_argumentos, '{}'::jsonb);
  v_limite int := case when p_acao in ('registrar_contrato', 'proposta_enviada') then 700 else 300 end;
begin
  perform mayara.expirar_pendentes();
  perform mayara.expirar_acoes_pendentes();
  if p_acao not in ('pausar', 'ligar', 'assumir', 'devolver', 'desfazer_regra', 'reativar_regra', 'abordar', 'registrar_contrato', 'proposta_enviada') then
    return 'Ação não reconhecida. Nada foi alterado.';
  end if;
  if p_acao = 'abordar' then
    return 'Essa ação ainda não está habilitada.';
  end if;
  if p_acao in ('assumir', 'devolver', 'registrar_contrato', 'proposta_enviada') and mayara.chave_telefone(v_args ->> 'telefone') is null then
    return 'Número inválido. Use o formato +5514999990000 (com DDD).';
  end if;
  if p_acao = 'registrar_contrato' and (jsonb_typeof(v_args -> 'contrato') is distinct from 'object'
                                        or jsonb_typeof(v_args -> 'contrato' -> 'parcelas') is distinct from 'array') then
    return 'Contrato inválido. Nada foi alterado.';
  end if;
  if p_acao in ('desfazer_regra', 'reativar_regra') and coalesce(v_args ->> 'numero', '') !~ '^[0-9]{1,9}$' then
    return 'Número da regra inválido. Veja os números em /regras.';
  end if;
  select resumo into v_pend from mayara.acoes_pendentes where estado = 'pendente';
  if v_pend is not null then
    return 'Ainda há uma ação aguardando confirmação: ' || v_pend || E'\nResponda *sim* ou *não* antes de pedir outra.';
  end if;
  select texto into v_pend from mayara.instrucoes where estado = 'pendente';
  if v_pend is not null then
    return 'Ainda há uma instrução aguardando confirmação: ' || v_pend || E'\nResponda *sim* ou *não* antes de pedir outra.';
  end if;
  insert into mayara.acoes_pendentes (acao, argumentos, resumo, autor_chave)
  values (p_acao, v_args, left(btrim(coalesce(p_resumo, '')), v_limite), coalesce(mayara.chave_telefone(p_autor), p_autor, ''));
  return left(btrim(coalesce(p_resumo, '')), v_limite) || E'\nConfirma? Responda *sim* ou *não* (vale por 10 minutos).';
exception when unique_violation then
  return 'Ainda há uma ação aguardando confirmação. Responda *sim* ou *não* antes de pedir outra.';
end $$;

create or replace function mayara.confirmar_acao_pendente(p_decisao text)
returns text language plpgsql set search_path = '' as $$
declare v mayara.acoes_pendentes%rowtype; r text;
begin
  perform mayara.expirar_acoes_pendentes();
  select * into v from mayara.acoes_pendentes where estado = 'pendente' for update;
  if not found then
    if not exists (select 1 from mayara.instrucoes where estado = 'pendente')
       and exists (select 1 from mayara.acoes_pendentes where estado = 'expirada' and encerrada_em > now() - interval '60 minutes') then
      return 'A ação expirou (passaram mais de 10 minutos). Peça de novo.';
    end if;
    return null;
  end if;
  if p_decisao <> 'sim' then
    update mayara.acoes_pendentes set estado = 'cancelada', encerrada_em = now() where id = v.id;
    return 'Ok, cancelei: ' || split_part(v.resumo, E'\n', 1);
  end if;
  update mayara.acoes_pendentes set estado = 'confirmada', encerrada_em = now() where id = v.id;
  r := case v.acao
    when 'assumir' then mayara.assumir_lead(v.argumentos ->> 'telefone')
    when 'devolver' then mayara.devolver_lead(v.argumentos ->> 'telefone')
    when 'desfazer_regra' then mayara.desfazer_instrucao((v.argumentos ->> 'numero')::bigint)
    when 'reativar_regra' then mayara.reativar_instrucao((v.argumentos ->> 'numero')::bigint)
    when 'registrar_contrato' then mayara.confirmar_contrato(v.argumentos)
    when 'proposta_enviada' then mayara.registrar_proposta(v.argumentos ->> 'telefone', v.argumentos ->> 'nome', nullif(v.argumentos ->> 'data', '')::date, 'central')
    when 'pausar' then '@efeito {"tipo":"modo","aiMode":"paused"}' || E'\nPausando a Mayara para todos os leads.'
    when 'ligar' then '@efeito {"tipo":"modo","aiMode":"active"}' || E'\nLigando a Mayara.'
    else 'Ação não reconhecida. Nada foi alterado.'
  end;
  return r;
end $$;

create or replace function mayara.executar_livre(p_pedido jsonb, p_autor text)
returns text language plpgsql set search_path = '' as $$
#variable_conflict use_column
declare
  v_acao text := coalesce(p_pedido ->> 'acao', '');
  v_alvo jsonb; v_tel text; v_nome text; v_rot text; v_num bigint; v_texto text;
  v_c jsonb; v_soma bigint; v_total bigint; v_crm text; v_resumo text; v_fora text;
  v_nao text := 'Não entendi com segurança, então nada foi feito. Reescreva o pedido ou use /ajuda.';
begin
  if p_pedido is null or jsonb_typeof(p_pedido) <> 'object' then
    return v_nao;
  end if;
  case v_acao
    when 'status' then return mayara.status_resumo();
    when 'listar_regras' then return mayara.regras_texto();
    when 'contagem_leads' then return mayara.contagem_leads(p_pedido ->> 'periodo');
    when 'pausar' then
      return mayara.criar_acao_pendente('pausar', '{}'::jsonb, 'Pausar a Mayara para todos os leads (os leads recebem o aviso de pausa).', p_autor);
    when 'ligar' then
      return mayara.criar_acao_pendente('ligar', '{}'::jsonb, 'Ligar a Mayara para todos os leads.', p_autor);
    when 'registrar_contrato' then
      if coalesce((select valor from mayara.config where chave = 'contrato_comando'), 'desligado') <> 'ligado' then
        return 'Essa ação ainda não está habilitada.';
      end if;
      v_c := p_pedido -> 'contrato';
      if jsonb_typeof(v_c) is distinct from 'object' or jsonb_typeof(v_c -> 'parcelas') is distinct from 'array'
         or coalesce(v_c ->> 'total_centavos', '') !~ '^[0-9]{1,12}$' then
        return v_nao;
      end if;
      v_total := (v_c ->> 'total_centavos')::bigint;
      select coalesce(sum((x ->> 'valor_centavos')::bigint), 0) into v_soma from jsonb_array_elements(v_c -> 'parcelas') x;
      if v_soma <> v_total then
        return 'A entrada mais as parcelas somam ' || mayara._brl(v_soma) || ' e o valor total é ' || mayara._brl(v_total)
               || ' (diferença de ' || mayara._brl(abs(v_soma - v_total)) || '). Nada foi gravado. Reenvie o pedido com os valores corrigidos.';
      end if;
      v_alvo := mayara._lead_do_pedido(p_pedido);
      if (v_alvo ->> 'ok') <> 'true' then
        return v_alvo ->> 'resposta';
      end if;
      v_tel := v_alvo ->> 'telefone';
      v_nome := nullif(v_alvo ->> 'nome', '');
      v_rot := coalesce(v_nome, 'cliente') || ' (final ' || right(coalesce(mayara.chave_telefone(v_tel), ''), 4) || ')';
      select la.espocrm_lead_id into v_crm from mayara.leads_autorizados la where la.telefone_chave = mayara.chave_telefone(v_tel);
      if v_crm is null then
        select c.id into v_crm from crm_sync.leads c where mayara.chave_telefone(c.phone) = mayara.chave_telefone(v_tel) limit 1;
      end if;
      v_fora := case when (v_alvo ->> 'na_lista') <> 'true' and (v_alvo ->> 'no_crm') <> 'true'
                     then ' (cliente fora da lista de leads: o contrato será ligado só ao telefone)' else '' end;
      v_resumo := 'Registrar contrato de ' || v_rot || v_fora || E':\n' || coalesce(v_c ->> 'resumo_corpo', 'Total: ' || mayara._brl(v_total) || '.');
      return mayara.criar_acao_pendente('registrar_contrato',
        jsonb_build_object('telefone', v_tel, 'nome', coalesce(v_nome, ''), 'crm_lead_id', coalesce(v_crm, ''), 'contrato', v_c), v_resumo, p_autor);
    when 'proposta_enviada' then
      if coalesce((select valor from mayara.config where chave = 'proposta_comando'), 'desligado') <> 'ligado' then
        return 'Essa ação ainda não está habilitada.';
      end if;
      v_alvo := mayara._lead_do_pedido(p_pedido);
      if (v_alvo ->> 'ok') <> 'true' then
        return v_alvo ->> 'resposta';
      end if;
      v_tel := v_alvo ->> 'telefone';
      v_nome := nullif(v_alvo ->> 'nome', '');
      v_rot := coalesce(v_nome, 'lead') || ' (final ' || right(coalesce(mayara.chave_telefone(v_tel), ''), 4) || ')';
      if coalesce(p_pedido ->> 'data', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' and coalesce(p_pedido ->> 'data', '') <> '' then
        return v_nao;
      end if;
      return mayara.criar_acao_pendente('proposta_enviada',
        jsonb_build_object('telefone', v_tel, 'nome', coalesce(v_nome, ''), 'data', coalesce(p_pedido ->> 'data', '')),
        'Registrar proposta enviada para ' || v_rot || ', em ' || coalesce(to_char(nullif(p_pedido ->> 'data', '')::date, 'DD/MM/YYYY'), to_char(painel._hoje(), 'DD/MM/YYYY'))
        || E'.\nO lead fica bloqueado para a Mayara (sem respostas nem follow-up normal), ela faz até 4 lembretes (3º, 7º, 14º e 25º dia útil) e você recebe um alerta se ele responder.', p_autor);
    when 'situacao_lead', 'assumir', 'devolver', 'abordar' then
      v_alvo := mayara._lead_do_pedido(p_pedido);
      if (v_alvo ->> 'ok') <> 'true' then
        return v_alvo ->> 'resposta';
      end if;
      v_tel := v_alvo ->> 'telefone';
      v_nome := nullif(v_alvo ->> 'nome', '');
      v_rot := coalesce(v_nome, 'lead') || ' (final ' || right(coalesce(mayara.chave_telefone(v_tel), ''), 4) || ')';
      if v_acao in ('assumir', 'devolver') and (v_alvo ->> 'na_lista') <> 'true' then
        return case when (v_alvo ->> 'no_crm') = 'true'
                    then 'O lead ' || v_rot || ' está no CRM, mas não está na lista de atendimento da Mayara: não há o que '
                    else 'O número ' || v_rot || ' não está na lista de atendimento da Mayara: não há o que '
               end || case v_acao when 'assumir' then 'assumir' else 'devolver' end || '. Nada foi feito.';
      end if;
      if v_acao = 'situacao_lead' then
        return mayara.situacao_lead(v_tel);
      elsif v_acao = 'assumir' then
        return mayara.criar_acao_pendente('assumir', jsonb_build_object('telefone', v_tel),
          'Assumir o lead ' || v_rot || ': a Mayara para de responder.', p_autor);
      elsif v_acao = 'devolver' then
        return mayara.criar_acao_pendente('devolver', jsonb_build_object('telefone', v_tel),
          'Devolver o lead ' || v_rot || ' para a Mayara.', p_autor);
      end if;
      return mayara.criar_acao_pendente('abordar', jsonb_build_object('telefone', v_tel),
        'Abordar o lead ' || v_rot || '.', p_autor);
    when 'desfazer_regra', 'reativar_regra' then
      if coalesce(p_pedido ->> 'numero_regra', '') !~ '^[0-9]{1,9}$' then
        return 'Não achei a regra. Veja os números em /regras.';
      end if;
      v_num := (p_pedido ->> 'numero_regra')::bigint;
      select texto into v_texto from mayara.instrucoes where id = v_num;
      if v_texto is null then
        return 'Não achei a regra ' || v_num::text || '. Veja os números em /regras.';
      end if;
      return mayara.criar_acao_pendente(v_acao, jsonb_build_object('numero', v_num::text),
        case when v_acao = 'desfazer_regra' then 'Desfazer' else 'Reativar' end
        || ' a regra ' || v_num::text || ': ' || left(v_texto, 120) || '.', p_autor);
    else
      return v_nao;
  end case;
end $$;

