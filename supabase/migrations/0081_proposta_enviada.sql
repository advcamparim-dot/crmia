-- Leads que receberam proposta: ficam bloqueados para a Mayara (sem resposta, sem follow-up normal, fora da reativacao),
-- recebem no maximo 4 lembretes curtos (3o, 7o, 14o e 25o dia util) e qualquer resposta gera so um alerta ao administrador.
alter table mayara.regua_followup drop constraint regua_followup_sequencia_check;
alter table mayara.regua_followup add constraint regua_followup_sequencia_check check (sequencia in ('conversa', 'nunca_respondeu', 'frio', 'proposta'));
insert into mayara.regua_followup (sequencia, etapa, tipo, minutos, dias_uteis, hora) values
  ('proposta', 1, 'dia', null, 3, '10:00'), ('proposta', 2, 'dia', null, 7, '10:00'),
  ('proposta', 3, 'dia', null, 14, '10:00'), ('proposta', 4, 'dia', null, 25, '10:00')
on conflict (sequencia, etapa) do nothing;

create or replace function mayara.agenda_followup(p_seq text, p_ciclo timestamp with time zone)
returns table(etapa integer, devido_em timestamp with time zone)
language plpgsql stable set search_path to '' as $function$
declare
  r record;
  v_prev timestamptz := p_ciclo;
  v_dev timestamptz;
  v_ref date := case when p_seq in ('nunca_respondeu', 'frio', 'proposta') then (p_ciclo at time zone 'America/Sao_Paulo')::date else null end;
begin
  for r in select * from mayara.regua_followup g where g.sequencia = p_seq order by g.etapa loop
    if r.tipo = 'encadeada' then
      v_dev := mayara.proxima_abertura(v_prev + make_interval(mins => r.minutos), 'followup');
      v_prev := v_dev;
      if r.etapa = 2 and p_seq = 'conversa' then
        v_ref := (v_dev at time zone 'America/Sao_Paulo')::date;
      end if;
    else
      v_dev := mayara.proxima_abertura(
        (mayara._somar_dias_uteis(v_ref, r.dias_uteis) + r.hora) at time zone 'America/Sao_Paulo', 'followup');
    end if;
    etapa := r.etapa;
    devido_em := v_dev;
    return next;
  end loop;
end $function$;

insert into mayara.config (chave, valor) values
  ('proposta_lembrete_modo', 'desligado'), ('proposta_limite_dia', '20'), ('proposta_intervalo_min', '25')
on conflict (chave) do nothing;

create table if not exists mayara.proposta_enviada (
  id bigserial primary key,
  telefone_chave text not null,
  nome text,
  crm_lead_id text,
  enviada_em date not null,
  estado text not null default 'ativa' check (estado in ('ativa', 'respondeu', 'encerrada')),
  etapa_atual integer not null default 0 check (etapa_atual between 0 and 4),
  ultimo_lembrete_em timestamptz,
  respondeu_em timestamptz,
  alertado_em timestamptz,
  falhas integer not null default 0,
  ultima_falha_em timestamptz,
  encerrada_em timestamptz,
  motivo text,
  criado_por text,
  criado_em timestamptz not null default now()
);
create unique index if not exists proposta_enviada_ativa_idx on mayara.proposta_enviada (telefone_chave) where estado = 'ativa';
alter table mayara.proposta_enviada enable row level security;
revoke all on mayara.proposta_enviada from public, anon, authenticated;

create table if not exists mayara.proposta_textos (
  etapa integer primary key check (etapa between 1 and 4),
  com_nome text not null,
  sem_nome text not null
);
alter table mayara.proposta_textos enable row level security;
revoke all on mayara.proposta_textos from public, anon, authenticated;
insert into mayara.proposta_textos (etapa, com_nome, sem_nome) values
  (1, 'Olá, {nome}. Aqui é a Mayara, do Camparim Advogados. Passando para saber se você conseguiu analisar a proposta que o Dr. Santo enviou. Se tiver qualquer dúvida, me diga que eu levo para ele.',
      'Olá. Aqui é a Mayara, do Camparim Advogados. Passando para saber se você conseguiu analisar a proposta que o Dr. Santo enviou. Se tiver qualquer dúvida, me diga que eu levo para ele.'),
  (2, '{nome}, tudo bem? Ficou alguma dúvida sobre a proposta, o prazo ou a forma de pagamento? Posso pedir para o Dr. Santo te retornar.',
      'Tudo bem? Ficou alguma dúvida sobre a proposta, o prazo ou a forma de pagamento? Posso pedir para o Dr. Santo te retornar.'),
  (3, '{nome}, a proposta continua à disposição. Se a sua situação mudou ou se quiser ajustar algo, me conte que eu aviso o Dr. Santo.',
      'A proposta continua à disposição. Se a sua situação mudou ou se quiser ajustar algo, me conte que eu aviso o Dr. Santo.'),
  (4, '{nome}, vou deixar a proposta em pausa por aqui. Se quiser retomar, é só me chamar. Obrigada pela confiança.',
      'Vou deixar a proposta em pausa por aqui. Se quiser retomar, é só me chamar. Obrigada pela confiança.')
on conflict (etapa) do nothing;

create or replace function mayara.proposta_texto(p_etapa integer, p_nome text)
returns text language sql stable set search_path = '' as $$
  select case when mayara.reativacao_primeiro_nome(p_nome) is null then t.sem_nome
              else replace(t.com_nome, '{nome}', mayara.reativacao_primeiro_nome(p_nome)) end
    from mayara.proposta_textos t where t.etapa = p_etapa
$$;

-- Marca a proposta, bloqueia o lead para a Mayara e devolve o resumo com as datas dos lembretes.
create or replace function mayara.registrar_proposta(p_telefone text, p_nome text, p_data date, p_autor text)
returns text language plpgsql set search_path = '' as $$
declare
  v_chave text := mayara.chave_telefone(p_telefone);
  v_hoje date := painel._hoje();
  v_data date := coalesce(p_data, painel._hoje());
  v_nome text := nullif(btrim(coalesce(p_nome, '')), '');
  v_crm text; v_id bigint; v_dias text;
begin
  if v_chave is null then return 'Número inválido. Use o formato +5514999990000 (com DDD).'; end if;
  if v_data > v_hoje or v_data < v_hoje - 120 then return 'A data da proposta precisa ser de hoje até 120 dias atrás. Nada foi registrado.'; end if;
  select la.espocrm_lead_id, coalesce(v_nome, la.nome) into v_crm, v_nome from mayara.leads_autorizados la where la.telefone_chave = v_chave;
  if not found then
    select c.id, coalesce(v_nome, c.name) into v_crm, v_nome from crm_sync.leads c where mayara.chave_telefone(c.phone) = v_chave limit 1;
    insert into mayara.leads_autorizados (telefone, nome, origem, espocrm_lead_id, status)
    values (p_telefone, v_nome, 'proposta_enviada', v_crm, 'bloqueado');
  else
    update mayara.leads_autorizados set status = 'bloqueado' where telefone_chave = v_chave and status <> 'bloqueado';
  end if;
  update mayara.proposta_enviada set estado = 'encerrada', encerrada_em = now(), motivo = 'substituida' where telefone_chave = v_chave and estado = 'ativa';
  insert into mayara.proposta_enviada (telefone_chave, nome, crm_lead_id, enviada_em, criado_por)
  values (v_chave, v_nome, v_crm, v_data, coalesce(p_autor, '')) returning id into v_id;
  select string_agg(to_char((a.devido_em at time zone 'America/Sao_Paulo')::date, 'DD/MM'), ', ' order by a.etapa) into v_dias
    from mayara.agenda_followup('proposta', (v_data::timestamp at time zone 'America/Sao_Paulo')) a;
  return 'Proposta registrada para ' || coalesce(v_nome, 'o lead') || ' (final ' || right(v_chave, 4) || '), enviada em '
         || to_char(v_data, 'DD/MM/YYYY') || '. O lead fica bloqueado para a Mayara e ela fará até 4 lembretes (' || v_dias
         || '). Se ele responder, você recebe um alerta.';
end $$;

-- Marca como "respondeu" quem escreveu depois do registro (para parar os lembretes). Nao consome o alerta.
create or replace function mayara._proposta_marcar_respostas()
returns void language sql set search_path = '' as $$
  update mayara.proposta_enviada p set estado = 'respondeu', respondeu_em = x.t
    from (select pp.id, min(e.quando) as t from mayara.proposta_enviada pp
            join painel._entradas() e on e.chave = pp.telefone_chave and e.quando > pp.criado_em
           where pp.estado = 'ativa' group by pp.id) x
   where p.id = x.id
$$;

-- Devolve, uma unica vez por proposta, quem respondeu e precisa de alerta ao administrador.
create or replace function mayara.proposta_respostas_novas()
returns table(proposta_id bigint, nome text, fim text, quando timestamptz)
language plpgsql set search_path = '' as $$
begin
  perform mayara._proposta_marcar_respostas();
  return query
    update mayara.proposta_enviada p set alertado_em = now()
     where p.estado = 'respondeu' and p.alertado_em is null
    returning p.id, p.nome, right(p.telefone_chave, 4), p.respondeu_em;
end $$;

-- Proximo lembrete devido (no maximo um por chamada). O robo envia e registra o resultado.
create or replace function mayara.proposta_proximo_lembrete(p_agora timestamptz default now())
returns jsonb language plpgsql set search_path = '' as $$
declare
  v_limite int := coalesce((select valor::int from mayara.config where chave = 'proposta_limite_dia'), 20);
  v_intervalo int := coalesce((select valor::int from mayara.config where chave = 'proposta_intervalo_min'), 25);
  p record; v_tel text; v_etapa int;
begin
  if coalesce((select valor from mayara.config where chave = 'proposta_lembrete_modo'), 'desligado') <> 'ligado' then
    return jsonb_build_object('enviar', false, 'motivo', 'desligado');
  end if;
  perform mayara._proposta_marcar_respostas();
  -- encerra o que nao deve mais receber lembrete
  update mayara.proposta_enviada x set estado = 'encerrada', encerrada_em = p_agora, motivo = 'contrato'
   where x.estado = 'ativa' and exists (select 1 from painel.contratos c where c.lead_chave = x.telefone_chave);
  update mayara.proposta_enviada x set estado = 'encerrada', encerrada_em = p_agora, motivo = 'sem_interesse'
   where x.estado = 'ativa' and exists (select 1 from mayara.leads_autorizados la where la.telefone_chave = x.telefone_chave and la.status = 'sem_interesse');
  if coalesce((select estado from mayara.canal_estado where canal_id = 'escritorio'), 'close') <> 'open' then
    return jsonb_build_object('enviar', false, 'motivo', 'canal_fechado');
  end if;
  if not mayara.followup_permitido(p_agora) then
    return jsonb_build_object('enviar', false, 'motivo', 'fora_do_expediente');
  end if;
  if (select count(*) from mayara.envios_log e where e.origem = 'proposta_lembrete' and e.ok
         and (e.criado_em at time zone 'America/Sao_Paulo')::date = (p_agora at time zone 'America/Sao_Paulo')::date) >= v_limite then
    return jsonb_build_object('enviar', false, 'motivo', 'teto_dia');
  end if;
  if exists (select 1 from mayara.envios_log e where e.origem = 'proposta_lembrete' and e.ok and e.criado_em > p_agora - make_interval(mins => v_intervalo)) then
    return jsonb_build_object('enviar', false, 'motivo', 'intervalo');
  end if;
  select x.id, x.nome, x.telefone_chave, x.etapa_atual + 1 as etapa, a.devido_em, la.telefone into p
    from mayara.proposta_enviada x
    join mayara.leads_autorizados la on la.telefone_chave = x.telefone_chave and la.status = 'bloqueado'
    cross join lateral mayara.agenda_followup('proposta', (x.enviada_em::timestamp at time zone 'America/Sao_Paulo')) a
   where x.estado = 'ativa' and x.etapa_atual < 4 and a.etapa = x.etapa_atual + 1 and a.devido_em <= p_agora
     and not (x.falhas >= 3 and x.ultima_falha_em > p_agora - interval '1 hour')
   order by a.devido_em, x.id limit 1;
  if p.id is null then
    return jsonb_build_object('enviar', false, 'motivo', 'fila_vazia');
  end if;
  return jsonb_build_object('enviar', true, 'proposta_id', p.id, 'etapa', p.etapa, 'destino', p.telefone,
                            'texto', mayara.proposta_texto(p.etapa, p.nome), 'nome', p.nome);
end $$;

create or replace function mayara.proposta_lembrete_registrar(p_id bigint, p_etapa integer, p_ok boolean, p_erro text)
returns void language plpgsql set search_path = '' as $$
begin
  if p_ok then
    update mayara.proposta_enviada set etapa_atual = greatest(etapa_atual, p_etapa), ultimo_lembrete_em = now(), falhas = 0,
           estado = case when p_etapa >= 4 then 'encerrada' else estado end,
           encerrada_em = case when p_etapa >= 4 then now() else encerrada_em end,
           motivo = case when p_etapa >= 4 then 'sequencia_concluida' else motivo end
     where id = p_id;
  else
    update mayara.proposta_enviada set falhas = falhas + 1, ultima_falha_em = now() where id = p_id;
  end if;
end $$;

revoke all on function mayara.proposta_texto(integer, text), mayara.registrar_proposta(text, text, date, text), mayara.proposta_respostas_novas(),
  mayara.proposta_proximo_lembrete(timestamptz), mayara.proposta_lembrete_registrar(bigint, integer, boolean, text), mayara._proposta_marcar_respostas() from public, anon, authenticated;
