-- Reativacao em massa dos leads do CRM que estao fora da lista (texto unico, 20 por dia).
-- Os leads entram na lista com origem 'reativacao_massa'. O robo "Abordagem: Liberar Automatica" ja existente envia o
-- proximo quando nao ha proposta aberta de lead novo (lead novo sempre passa na frente). Desligada por padrao.
insert into mayara.config (chave, valor) values
  ('reativacao_ligada', 'false'),
  ('reativacao_limite_dia', '20'),
  ('reativacao_intervalo_min', '25'),
  ('reativacao_texto', E'Olá, {nome}. Tudo bem? Aqui é a Mayara, do Camparim Advogados.\n\nVocê nos procurou há alguns dias sobre renegociação de dívida e eu não quis deixar sua solicitação sem retorno. Você ainda precisa de ajuda com isso?')
on conflict (chave) do nothing;

-- Primeiro nome para a saudacao; nulo quando o nome nao parece de pessoa (empresa, sigla, nome repetido).
create or replace function mayara.reativacao_primeiro_nome(p_nome text)
returns text language plpgsql immutable set search_path = '' as $$
declare
  v_nome text := btrim(coalesce(p_nome, ''));
  v_partes text[];
  v_primeiro text;
begin
  if v_nome = '' or v_nome ~ '[|&@0-9/]' then return null; end if;
  if v_nome ~* '(materia|obras|agro|ltda|comercio|comércio|constru|distribui|empresa|negocio|negócio|servi[cç]o|transporte|auto ?pe[cç]as|eireli|epp|\mme\M)' then return null; end if;
  v_partes := regexp_split_to_array(v_nome, '\s+');
  v_primeiro := v_partes[1];
  if v_primeiro !~ '^[A-Za-zÀ-ÿ''-]+$' or char_length(v_primeiro) < 3 then return null; end if;
  if array_length(v_partes, 1) >= 2 and lower(v_partes[1]) = lower(v_partes[2]) then return null; end if;
  return upper(left(v_primeiro, 1)) || lower(substr(v_primeiro, 2));
end $$;

create or replace function mayara.reativacao_texto_para(p_nome text)
returns text language sql stable set search_path = '' as $$
  select case when mayara.reativacao_primeiro_nome(p_nome) is null
              then replace(t.valor, ', {nome}', '')
              else replace(t.valor, '{nome}', mayara.reativacao_primeiro_nome(p_nome)) end
    from mayara.config t where t.chave = 'reativacao_texto'
$$;

-- Cadastra na lista os leads do CRM que ainda nao estao nela. Idempotente. Nao envia nada.
create or replace function mayara.reativacao_cadastrar()
returns integer language plpgsql set search_path = '' as $$
declare v_n integer;
begin
  insert into mayara.leads_autorizados (telefone, nome, origem, espocrm_lead_id)
  select l.phone, nullif(btrim(l.name), ''), 'reativacao_massa', l.id
    from crm_sync.leads l
   where l.phone ~ '^\+55[0-9]{10,11}$'
     and not exists (select 1 from mayara.leads_autorizados a
                      where a.espocrm_lead_id = l.id or a.telefone_chave = mayara.chave_telefone(l.phone))
  on conflict do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- Cria a proxima proposta de reativacao (a que o robo vai aprovar e enviar). Devolve o id ou nulo.
create or replace function mayara.reativacao_proxima(p_agora timestamptz default now())
returns bigint language plpgsql set search_path = '' as $$
declare
  v_limite int := coalesce((select valor::int from mayara.config where chave = 'reativacao_limite_dia'), 20);
  v_intervalo int := coalesce((select valor::int from mayara.config where chave = 'reativacao_intervalo_min'), 25);
  v_hoje int; v_ultima timestamptz; r record; c jsonb;
begin
  if coalesce((select valor from mayara.config where chave = 'reativacao_ligada'), 'false') <> 'true' then return null; end if;
  select count(*), max(p.criado_em) into v_hoje, v_ultima
    from mayara.propostas_abordagem p
   where p.lacuna = 'reativacao_massa' and p.estado in ('aprovada', 'enviada', 'aberta')
     and (p.criado_em at time zone 'America/Sao_Paulo')::date = (p_agora at time zone 'America/Sao_Paulo')::date;
  if v_hoje >= v_limite then return null; end if;
  if v_ultima is not null and p_agora - v_ultima < make_interval(mins => v_intervalo) then return null; end if;
  for r in
    select la.telefone, la.nome, la.espocrm_lead_id
      from mayara.leads_autorizados la
      left join crm_sync.leads l on l.id = la.espocrm_lead_id
     where la.origem = 'reativacao_massa' and la.status = 'ativo' and la.abordagem_ate is null
       and not exists (select 1 from mayara.propostas_abordagem p where p.telefone_chave = la.telefone_chave)
     order by l.created_at desc nulls last, la.criado_em desc, la.telefone
     limit 5
  loop
    c := mayara.criar_proposta(r.telefone, r.nome, r.espocrm_lead_id, mayara.reativacao_texto_para(r.nome), '{}'::jsonb, 'reativacao_massa');
    if coalesce((c ->> 'ok')::boolean, false) then
      return (c ->> 'id')::bigint;
    end if;
  end loop;
  return null;
end $$;

-- O inicio do ciclo da regua tambem conta o envio da abordagem automatica (antes so contava 'ponte' e 'abordagem_assistida').
create or replace function mayara._ultima_saida(p_chave text)
returns timestamptz language sql stable set search_path = '' as $$
  select max(l.criado_em) from mayara.envios_log l
   where l.destino_chave = p_chave and l.ok and l.origem in ('ponte', 'abordagem_assistida', 'abordagem_automatica', 'reativacao')
$$;

create or replace function mayara.abordagem_auto_proximo(p_agora timestamptz default now())
returns jsonb language plpgsql set search_path = '' as $$
declare
  p mayara.propostas_abordagem%rowtype;
  v_teto int := coalesce((select valor::int from mayara.config where chave = 'abordagem_auto_teto_hora'), 10);
  v_status text; v_motivo text; r jsonb;
begin
  if coalesce((select valor from mayara.config where chave = 'abordagem_automatica'), 'false') <> 'true' then
    return jsonb_build_object('enviar', false, 'motivo', 'desligada');
  end if;
  if coalesce((select valor from mayara.config where chave = 'abordagem_assistida'), 'false') <> 'true' then
    return jsonb_build_object('enviar', false, 'motivo', 'assistida_desligada');
  end if;
  if coalesce((select estado from mayara.canal_estado where canal_id = 'escritorio'), 'close') <> 'open' then
    return jsonb_build_object('enviar', false, 'motivo', 'canal_fechado');
  end if;
  if not mayara.resposta_permitida(p_agora) then
    return jsonb_build_object('enviar', false, 'motivo', 'fora_do_expediente');
  end if;

  -- sem lead novo esperando, prepara a proxima reativacao (tem teto proprio por dia e intervalo; nao consome o teto por hora)
  if not exists (select 1 from mayara.propostas_abordagem x where x.estado = 'aberta') then
    perform mayara.reativacao_proxima(p_agora);
  end if;

  select * into p
    from mayara.propostas_abordagem x
   where x.estado = 'aberta'
   order by (x.lacuna = 'reativacao_massa') nulls first, x.criado_em, x.id
   limit 1
   for update skip locked;
  if not found then
    return jsonb_build_object('enviar', false, 'motivo', 'fila_vazia');
  end if;

  -- o teto por hora vale para lead novo; a reativacao tem o teto diario proprio
  if p.lacuna is distinct from 'reativacao_massa' and
     (select count(*) from mayara.envios_log e
       where e.origem = 'abordagem_automatica' and e.ok and e.criado_em > p_agora - interval '1 hour'
         and not exists (select 1 from mayara.propostas_abordagem y
                          where y.telefone_chave = e.destino_chave and y.lacuna = 'reativacao_massa')) >= v_teto then
    return jsonb_build_object('enviar', false, 'motivo', 'teto_hora');
  end if;

  select la.status into v_status from mayara.leads_autorizados la where la.telefone_chave = p.telefone_chave;
  v_motivo := case
    when exists (select 1 from mayara.administradores a where a.telefone_chave = p.telefone_chave) then 'administrador'
    when v_status is not null and v_status <> 'ativo' then 'lead_inativo'
    when exists (select 1 from mayara.session_state s
                  where mayara.chave_telefone(s.phone) = p.telefone_chave
                    and s.last_lead_message_at > p_agora - interval '48 hours') then 'conversa_recente'
    else null
  end;
  if v_motivo is not null then
    update mayara.propostas_abordagem set estado = 'descartada', encerrada_em = p_agora, erro = v_motivo where id = p.id;
    return jsonb_build_object('enviar', false, 'motivo', 'descartada', 'proposta_id', p.id);
  end if;

  r := mayara.aprovar_proposta(p.id, 'automatico');
  if coalesce((r ->> 'ok')::boolean, false) is not true then
    return jsonb_build_object('enviar', false, 'motivo', coalesce(r ->> 'motivo', 'nao_aprovada'), 'proposta_id', p.id);
  end if;
  return jsonb_build_object('enviar', true, 'proposta_id', p.id, 'destino', r ->> 'destino', 'texto', r ->> 'texto',
                            'nome', r ->> 'nome', 'crm_lead_id', r ->> 'crm_lead_id');
end $$;

revoke all on function mayara.reativacao_primeiro_nome(text), mayara.reativacao_texto_para(text), mayara.reativacao_cadastrar(),
  mayara.reativacao_proxima(timestamptz) from public, anon, authenticated;
