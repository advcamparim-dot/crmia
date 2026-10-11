-- Regua de follow-up: calendario por sequencia, estado por lead, log e chaves.
-- Decisao do usuario (10/10): a Mayara retoma na abertura (06:00); a janela de follow-up passa a abrir as 06:00.
update mayara.expediente set abre_followup = '06:00' where dia_semana between 1 and 6;

insert into mayara.config (chave, valor) values
  ('followup_modo', 'desligado'),
  ('followup_teto', '14'),
  ('followup_limite_hora', '15'),
  ('followup_intervalo_minimo_min', '25'),
  ('followup_dias_entrada', '7')
on conflict (chave) do nothing;

create table mayara.regua_followup (
  sequencia text not null check (sequencia in ('conversa', 'nunca_respondeu')),
  etapa int not null,
  tipo text not null check (tipo in ('encadeada', 'dia')),
  minutos int,
  dias_uteis int,
  hora time,
  primary key (sequencia, etapa)
);
-- encadeada: minutos depois da etapa anterior (a etapa 1, depois da ultima mensagem da Mayara)
-- dia: dias de atendimento depois do dia de referencia, no horario fixo
insert into mayara.regua_followup (sequencia, etapa, tipo, minutos, dias_uteis, hora) values
  ('conversa', 1, 'encadeada', 30, null, null),
  ('conversa', 2, 'encadeada', 90, null, null),
  ('conversa', 3, 'encadeada', 240, null, null),
  ('conversa', 4, 'dia', null, 1, '10:00'), ('conversa', 5, 'dia', null, 1, '16:00'),
  ('conversa', 6, 'dia', null, 2, '10:00'), ('conversa', 7, 'dia', null, 2, '16:00'),
  ('conversa', 8, 'dia', null, 3, '10:00'), ('conversa', 9, 'dia', null, 3, '16:00'),
  ('conversa', 10, 'dia', null, 5, '10:00'), ('conversa', 11, 'dia', null, 7, '10:00'),
  ('conversa', 12, 'dia', null, 9, '10:00'), ('conversa', 13, 'dia', null, 11, '10:00'),
  ('conversa', 14, 'dia', null, 13, '10:00'),
  ('nunca_respondeu', 1, 'encadeada', 30, null, null),
  ('nunca_respondeu', 2, 'encadeada', 90, null, null),
  ('nunca_respondeu', 3, 'encadeada', 240, null, null),
  ('nunca_respondeu', 4, 'dia', null, 1, '10:00'),
  ('nunca_respondeu', 5, 'dia', null, 1, '16:00'),
  ('nunca_respondeu', 6, 'dia', null, 2, '14:00');
insert into mayara.regua_followup (sequencia, etapa, tipo, dias_uteis, hora)
select 'nunca_respondeu', e, 'dia', e - 4, '10:00' from generate_series(7, 13) e;
insert into mayara.regua_followup (sequencia, etapa, tipo, dias_uteis, hora)
select 'nunca_respondeu', e, 'dia', 9 + 2 * (e - 13), '10:00' from generate_series(14, 40) e;

create table mayara.followup_estado (
  chave text primary key,
  ciclo_saida timestamptz,
  etapa_atual int not null default 0,
  enviados_total int not null default 0,
  ultimo_envio_em timestamptz,
  status text not null default 'ativo' check (status in ('ativo', 'encerrado', 'suspenso', 'revisao_humana')),
  pausado_ate timestamptz,
  texto_proximo text,
  atualizado_em timestamptz not null default now()
);

create table mayara.followups_log (
  id bigserial primary key,
  chave text not null,
  sequencia text not null,
  etapa int not null,
  estado text not null check (estado in ('reservado', 'simulado', 'enviado', 'cancelado', 'falhou')),
  texto text,
  fonte text,
  motivo text,
  ciclo_saida timestamptz,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create unique index followups_log_um_reservado on mayara.followups_log (chave) where estado = 'reservado';
create index followups_log_chave on mayara.followups_log (chave, criado_em);

alter table mayara.regua_followup enable row level security;
alter table mayara.followup_estado enable row level security;
alter table mayara.followups_log enable row level security;
revoke all on mayara.regua_followup from anon, authenticated;
revoke all on mayara.followup_estado from anon, authenticated;
revoke all on mayara.followups_log from anon, authenticated;

create or replace function mayara._somar_dias_uteis(p_data date, p_n int)
returns date language plpgsql stable set search_path = '' as $$
declare d date := p_data; c int := 0;
begin
  while c < greatest(p_n, 0) loop
    d := d + 1;
    if mayara.dia_aberto(d) then
      c := c + 1;
    end if;
  end loop;
  return d;
end $$;

create or replace function mayara.agenda_followup(p_seq text, p_ciclo timestamptz)
returns table (etapa int, devido_em timestamptz)
language plpgsql stable set search_path = '' as $$
declare
  r record;
  v_prev timestamptz := p_ciclo;
  v_dev timestamptz;
  v_ref date := case when p_seq = 'nunca_respondeu' then (p_ciclo at time zone 'America/Sao_Paulo')::date else null end;
begin
  for r in select * from mayara.regua_followup g where g.sequencia = p_seq order by g.etapa loop
    if r.tipo = 'encadeada' then
      v_dev := mayara.proxima_abertura(v_prev + make_interval(mins => r.minutos), 'followup');
      v_prev := v_dev;
      if r.etapa = 3 and p_seq = 'conversa' then
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
end $$;

revoke all on function mayara._somar_dias_uteis(date, int) from public, anon, authenticated;
revoke all on function mayara.agenda_followup(text, timestamptz) from public, anon, authenticated;
