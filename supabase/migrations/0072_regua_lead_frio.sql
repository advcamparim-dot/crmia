-- Regua do lead frio (reativacao em massa): quem veio da reativacao e nunca respondeu recebe um toque por dia util,
-- 14 dias uteis seguidos, alternando manha (10h, dias impares) e tarde (16h, dias pares). O dia 1 e o dia util
-- seguinte ao envio da reativacao. Quem responder e voltar a ficar em silencio cai na sequencia 'conversa'.
alter table mayara.regua_followup drop constraint regua_followup_sequencia_check;
alter table mayara.regua_followup add constraint regua_followup_sequencia_check check (sequencia in ('conversa', 'nunca_respondeu', 'frio'));

insert into mayara.regua_followup (sequencia, etapa, tipo, minutos, dias_uteis, hora)
select 'frio', e, 'dia', null, e, case when e % 2 = 1 then time '10:00' else time '16:00' end
  from generate_series(1, 14) e
on conflict (sequencia, etapa) do nothing;

create or replace function mayara.agenda_followup(p_seq text, p_ciclo timestamp with time zone)
returns table(etapa integer, devido_em timestamp with time zone)
language plpgsql stable set search_path to '' as $function$
declare
  r record;
  v_prev timestamptz := p_ciclo;
  v_dev timestamptz;
  v_ref date := case when p_seq in ('nunca_respondeu', 'frio') then (p_ciclo at time zone 'America/Sao_Paulo')::date else null end;
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

create or replace function mayara.followups_elegiveis(p_agora timestamp with time zone default now())
returns table(lead_chave text, lead_sequencia text, lead_etapa integer, lead_ciclo timestamp with time zone, lead_devido timestamp with time zone, lead_nome text, lead_telefone text)
language plpgsql stable set search_path to '' as $function$
declare
  v_teto int := coalesce((select valor::int from mayara.config where chave = 'followup_teto'), 14);
  v_intervalo int := coalesce((select valor::int from mayara.config where chave = 'followup_intervalo_minimo_min'), 25);
  v_dias int := coalesce((select valor::int from mayara.config where chave = 'followup_dias_entrada'), 7);
  v_ultima int := least(coalesce((select valor::int from mayara.config where chave = 'followup_teto'), 14), 14);
begin
  return query
  with base as (
    select la.telefone_chave as chave, la.nome, la.telefone, la.origem,
           mayara._ultima_saida(la.telefone_chave) as ciclo_saida,
           mayara._ultima_entrada(la.telefone_chave) as entrada,
           mayara._qtd_entradas(la.telefone_chave) as n_entradas
      from mayara.leads_autorizados la where la.status = 'ativo'
  ), silenciosos as (
    select b.*, case when b.n_entradas > 0 then 'conversa'
                     when b.origem = 'reativacao_massa' then 'frio'
                     else 'nunca_respondeu' end as sequencia
      from base b
     where b.ciclo_saida is not null and (b.entrada is null or b.ciclo_saida > b.entrada)
  ), com_estado as (
    select s.*, fe.enviados_total, fe.ultimo_envio_em, (fe.chave is not null) as tem_estado,
           case when fe.ciclo_saida = s.ciclo_saida then fe.etapa_atual else 0 end as etapa_efetiva
      from silenciosos s left join mayara.followup_estado fe on fe.chave = s.chave
  ), candidatos as (
    select c.*,
           (select max(a.etapa) from mayara.agenda_followup(c.sequencia, c.ciclo_saida) a
             where a.devido_em <= p_agora and a.etapa > c.etapa_efetiva and a.etapa <= v_ultima) as etapa_dev
      from com_estado c
     where coalesce(c.enviados_total, 0) < v_teto
       and (c.ultimo_envio_em is null or p_agora - c.ultimo_envio_em >= make_interval(mins => v_intervalo))
       and (c.tem_estado or c.ciclo_saida >= p_agora - make_interval(days => v_dias))
       and mayara._lead_excluido(c.chave, p_agora) is null
  )
  select c.chave, c.sequencia, c.etapa_dev, c.ciclo_saida,
         (select a.devido_em from mayara.agenda_followup(c.sequencia, c.ciclo_saida) a where a.etapa = c.etapa_dev),
         c.nome, c.telefone
    from candidatos c where c.etapa_dev is not null;
end $function$;
