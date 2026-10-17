create or replace function mayara.comando_abordagem(p_args text)
returns text language plpgsql set search_path = '' as $$
declare
  v_args text := lower(btrim(coalesce(p_args, '')));
  v_sub text := split_part(v_args, ' ', 1);
  v_acao text := btrim(substr(v_args, length(split_part(v_args, ' ', 1)) + 1));
  v_teto int := coalesce((select valor::int from mayara.config where chave = 'abordagem_auto_teto_hora'), 10);
  v_ligada boolean := coalesce((select valor from mayara.config where chave = 'abordagem_automatica'), 'false') = 'true';
  v_res jsonb;
begin
  if v_sub not in ('automatica', 'automática') then
    return 'Use /abordagem automatica status, /abordagem automatica ligar ou /abordagem automatica desligar.';
  end if;
  if v_acao in ('', 'status') then
    v_res := mayara.abordagem_auto_resumo(24);
    return 'Liberação automática: ' || case when v_ligada then 'ligada' else 'desligada' end
      || '. Limite de ' || v_teto::text || ' por hora, no horário de atendimento.'
      || E'\nÚltimas 24 h: ' || (v_res ->> 'enviadas') || ' enviadas, ' || (v_res ->> 'falhas') || ' falhas, '
      || (v_res ->> 'descartadas') || ' descartadas.'
      || E'\nPropostas abertas aguardando você: ' || (v_res ->> 'abertas') || '.';
  end if;
  if v_acao = 'ligar' then
    if coalesce((select valor from mayara.config where chave = 'abordagem_assistida'), 'false') <> 'true' then
      return 'Não liguei: a abordagem assistida está desligada, e a liberação automática depende dela.';
    end if;
    update mayara.config set valor = 'true' where chave = 'abordagem_automatica';
    return 'Liberação automática ligada. Lead novo recebe o primeiro contato da Mayara sozinho (até '
      || v_teto::text || ' por hora, no horário de atendimento). Para desligar: /abordagem automatica desligar.';
  end if;
  if v_acao = 'desligar' then
    update mayara.config set valor = 'false' where chave = 'abordagem_automatica';
    return 'Liberação automática desligada. Voltam a valer as aprovações com sim e não.';
  end if;
  return 'Use /abordagem automatica status, /abordagem automatica ligar ou /abordagem automatica desligar.';
end $$;

create or replace function mayara.executar_central(p_fn text, p_arg text, p_arg2 text, p_autor text)
returns text language plpgsql set search_path = '' as $$
declare v_pedido jsonb;
begin
  if p_fn = 'livre' then
    begin
      v_pedido := p_arg::jsonb;
    exception when others then
      v_pedido := null;
    end;
    return mayara.executar_livre(v_pedido, p_autor);
  end if;
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
    when 'abordagem' then mayara.comando_abordagem(p_arg)
    else 'Comando não reconhecido. Envie /ajuda.'
  end;
end $$;

revoke all on function mayara.comando_abordagem(text) from public, anon, authenticated;
revoke all on function mayara.executar_central(text, text, text, text) from public, anon, authenticated;
