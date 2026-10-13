-- supabase/migrations/0047_mayara_central_livre.sql
create or replace function mayara._lead_do_pedido(p_pedido jsonb)
returns jsonb language plpgsql stable set search_path = '' as $$
#variable_conflict use_column
declare
  v_tel text := nullif(btrim(coalesce(p_pedido ->> 'telefone', '')), '');
  v_nome text := btrim(coalesce(p_pedido ->> 'nome', ''));
  v_lista jsonb; v_n int; v_txt text; v_nome_enc text; v_tel_enc text;
begin
  if v_tel is not null then
    select l.nome into v_nome_enc from mayara.leads_autorizados l where l.telefone_chave = mayara.chave_telefone(v_tel);
    return jsonb_build_object('ok', true, 'telefone', v_tel, 'nome', coalesce(v_nome_enc, ''));
  end if;
  if v_nome = '' then
    return jsonb_build_object('ok', false, 'resposta', 'Diga o nome ou o telefone do lead. Nada foi feito.');
  end if;
  v_lista := mayara.buscar_leads_por_nome(v_nome);
  v_n := jsonb_array_length(v_lista);
  if v_n = 0 then
    return jsonb_build_object('ok', false, 'resposta',
      'Não achei nenhum lead com o nome «' || v_nome || '». Envie o telefone, por exemplo +5514999990000.');
  end if;
  if v_n > 1 then
    select string_agg(x.ordem::text || '. ' || (x.item ->> 'nome') || ' (final ' || (x.item ->> 'fim') || ')', E'\n' order by x.ordem)
      into v_txt
      from (select item, row_number() over () as ordem from jsonb_array_elements(v_lista) as item limit 5) x;
    return jsonb_build_object('ok', false, 'resposta',
      'Encontrei mais de um lead com esse nome:' || E'\n' || v_txt || E'\nRepita o pedido com o telefone.');
  end if;
  v_tel_enc := nullif(btrim(coalesce(v_lista -> 0 ->> 'telefone', '')), '');
  if v_tel_enc is null then
    return jsonb_build_object('ok', false, 'resposta',
      'O lead «' || coalesce(v_lista -> 0 ->> 'nome', v_nome) || '» não tem telefone cadastrado. Nada foi feito.');
  end if;
  return jsonb_build_object('ok', true, 'telefone', v_tel_enc, 'nome', coalesce(v_lista -> 0 ->> 'nome', ''));
end $$;

create or replace function mayara.executar_livre(p_pedido jsonb, p_autor text)
returns text language plpgsql set search_path = '' as $$
#variable_conflict use_column
declare
  v_acao text := coalesce(p_pedido ->> 'acao', '');
  v_alvo jsonb; v_tel text; v_nome text; v_rot text; v_num bigint; v_texto text;
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
    when 'situacao_lead', 'assumir', 'devolver', 'abordar' then
      v_alvo := mayara._lead_do_pedido(p_pedido);
      if (v_alvo ->> 'ok') <> 'true' then
        return v_alvo ->> 'resposta';
      end if;
      v_tel := v_alvo ->> 'telefone';
      v_nome := nullif(v_alvo ->> 'nome', '');
      v_rot := coalesce(v_nome, 'lead') || ' (final ' || right(coalesce(mayara.chave_telefone(v_tel), ''), 4) || ')';
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
    else 'Comando não reconhecido. Envie /ajuda.'
  end;
end $$;

create or replace function mayara.contexto_central(p_telefone text)
returns jsonb language plpgsql set search_path = '' as $$
declare v_prop jsonb;
begin
  perform mayara.expirar_pendentes();
  perform mayara.expirar_acoes_pendentes();
  v_prop := mayara.proposta_sem_numero();
  return jsonb_build_object(
    'pendente', exists (select 1 from mayara.instrucoes where estado = 'pendente'),
    'acao_pendente', exists (select 1 from mayara.acoes_pendentes where estado = 'pendente'),
    'exclusivo', coalesce((select valor from mayara.config where chave = 'canal_comando_exclusivo'), 'false') = 'true',
    'livre', coalesce((select valor from mayara.config where chave = 'central_linguagem_livre'), 'false') = 'true',
    'propostas_abertas', (v_prop ->> 'qtd')::int,
    'proposta_unica', v_prop -> 'id'
  );
end $$;

revoke all on function mayara._lead_do_pedido(jsonb) from public, anon, authenticated;
revoke all on function mayara.executar_livre(jsonb, text) from public, anon, authenticated;
revoke all on function mayara.executar_central(text, text, text, text) from public, anon, authenticated;
revoke all on function mayara.contexto_central(text) from public, anon, authenticated;
