-- Expediente de atendimento: dias e horarios em que a Mayara responde leads e faz follow-up.
-- Horario de Brasilia. Domingo e feriados nacionais fechados. Editavel pelas tabelas.

create table mayara.expediente (
  dia_semana int primary key check (dia_semana between 0 and 6), -- 0 = domingo (extract dow)
  aberto boolean not null,
  abre_resposta time,
  fecha_resposta time,
  abre_followup time,
  fecha_followup time
);
insert into mayara.expediente (dia_semana, aberto, abre_resposta, fecha_resposta, abre_followup, fecha_followup) values
  (0, false, null, null, null, null),
  (1, true, '06:00', '21:00', '08:00', '19:00'),
  (2, true, '06:00', '21:00', '08:00', '19:00'),
  (3, true, '06:00', '21:00', '08:00', '19:00'),
  (4, true, '06:00', '21:00', '08:00', '19:00'),
  (5, true, '06:00', '21:00', '08:00', '19:00'),
  (6, true, '06:00', '18:00', '08:00', '18:00');

create table mayara.feriados_nacionais (
  data date primary key,
  nome text not null
);
insert into mayara.feriados_nacionais (data, nome)
select make_date(a, v.m, v.d), v.nome
from generate_series(2026, 2030) a,
     (values (1, 1, 'Confraternização Universal'), (4, 21, 'Tiradentes'), (5, 1, 'Dia do Trabalho'),
             (9, 7, 'Independência'), (10, 12, 'Nossa Senhora Aparecida'), (11, 2, 'Finados'),
             (11, 15, 'Proclamação da República'), (11, 20, 'Consciência Negra'), (12, 25, 'Natal')) v(m, d, nome);
insert into mayara.feriados_nacionais (data, nome) values
  ('2026-04-03', 'Sexta-feira Santa'), ('2027-03-26', 'Sexta-feira Santa'), ('2028-04-14', 'Sexta-feira Santa'),
  ('2029-03-30', 'Sexta-feira Santa'), ('2030-04-19', 'Sexta-feira Santa');

alter table mayara.expediente enable row level security;
alter table mayara.feriados_nacionais enable row level security;
revoke all on mayara.expediente from anon, authenticated;
revoke all on mayara.feriados_nacionais from anon, authenticated;

create or replace function mayara.dia_aberto(p_data date)
returns boolean language sql stable set search_path = '' as $$
  select coalesce((select e.aberto from mayara.expediente e where e.dia_semana = extract(dow from p_data)::int), false)
         and not exists (select 1 from mayara.feriados_nacionais f where f.data = p_data)
$$;

create or replace function mayara._janela_aberta(p_agora timestamptz, p_tipo text)
returns boolean language plpgsql stable set search_path = '' as $$
declare
  v_local timestamp := p_agora at time zone 'America/Sao_Paulo';
  e mayara.expediente%rowtype;
  v_abre time;
  v_fecha time;
begin
  if not mayara.dia_aberto(v_local::date) then
    return false;
  end if;
  select * into e from mayara.expediente where dia_semana = extract(dow from v_local)::int;
  v_abre := case p_tipo when 'followup' then e.abre_followup else e.abre_resposta end;
  v_fecha := case p_tipo when 'followup' then e.fecha_followup else e.fecha_resposta end;
  return v_local::time >= v_abre and v_local::time < v_fecha;
end $$;

create or replace function mayara.resposta_permitida(p_agora timestamptz default now())
returns boolean language sql stable set search_path = '' as $$
  select mayara._janela_aberta(p_agora, 'resposta')
$$;

create or replace function mayara.followup_permitido(p_agora timestamptz default now())
returns boolean language sql stable set search_path = '' as $$
  select mayara._janela_aberta(p_agora, 'followup')
$$;

create or replace function mayara.proxima_abertura(p_agora timestamptz default now(), p_tipo text default 'resposta')
returns timestamptz language plpgsql stable set search_path = '' as $$
declare
  v_local timestamp := p_agora at time zone 'America/Sao_Paulo';
  d date := v_local::date;
  e mayara.expediente%rowtype;
  v_abre time;
  v_fecha time;
begin
  for i in 0..20 loop
    if mayara.dia_aberto(d) then
      select * into e from mayara.expediente where dia_semana = extract(dow from d)::int;
      v_abre := case p_tipo when 'followup' then e.abre_followup else e.abre_resposta end;
      v_fecha := case p_tipo when 'followup' then e.fecha_followup else e.fecha_resposta end;
      if i = 0 then
        if v_local::time < v_abre then
          return (d + v_abre) at time zone 'America/Sao_Paulo';
        elsif v_local::time < v_fecha then
          return p_agora;
        end if;
      else
        return (d + v_abre) at time zone 'America/Sao_Paulo';
      end if;
    end if;
    d := d + 1;
  end loop;
  return null;
end $$;

revoke all on function mayara.dia_aberto(date) from public, anon, authenticated;
revoke all on function mayara._janela_aberta(timestamptz, text) from public, anon, authenticated;
revoke all on function mayara.resposta_permitida(timestamptz) from public, anon, authenticated;
revoke all on function mayara.followup_permitido(timestamptz) from public, anon, authenticated;
revoke all on function mayara.proxima_abertura(timestamptz, text) from public, anon, authenticated;
