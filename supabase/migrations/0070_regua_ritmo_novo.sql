-- Ritmo novo da regua de follow-up (aprovado em 21/10): 2 mensagens no primeiro dia (+2h e +6h desde o silencio),
-- depois no maximo uma por dia util, com mais espaco no fim; 14 mensagens ao longo de 23 dias uteis.
-- Os 14 textos distintos por etapa nao mudam. Etapas 15 a 26 de nunca_respondeu ficam como estao (o teto de 14 as ignora).
update mayara.regua_followup set tipo = 'encadeada', minutos = 120, dias_uteis = null, hora = null where sequencia in ('conversa', 'nunca_respondeu') and etapa = 1;
update mayara.regua_followup set tipo = 'encadeada', minutos = 240, dias_uteis = null, hora = null where sequencia in ('conversa', 'nunca_respondeu') and etapa = 2;

update mayara.regua_followup g set tipo = 'dia', minutos = null, dias_uteis = v.du, hora = v.hora::time
  from (values
    ('conversa', 3, 1, '10:00'), ('conversa', 4, 2, '16:00'), ('conversa', 5, 3, '10:00'), ('conversa', 6, 5, '10:00'),
    ('conversa', 7, 7, '10:00'), ('conversa', 8, 9, '10:00'), ('conversa', 9, 11, '10:00'), ('conversa', 10, 13, '10:00'),
    ('conversa', 11, 15, '10:00'), ('conversa', 12, 17, '10:00'), ('conversa', 13, 20, '10:00'), ('conversa', 14, 23, '10:00'),
    ('nunca_respondeu', 3, 1, '10:00'), ('nunca_respondeu', 4, 2, '14:00'), ('nunca_respondeu', 5, 3, '10:00'), ('nunca_respondeu', 6, 5, '10:00'),
    ('nunca_respondeu', 7, 7, '10:00'), ('nunca_respondeu', 8, 9, '10:00'), ('nunca_respondeu', 9, 11, '10:00'), ('nunca_respondeu', 10, 13, '10:00'),
    ('nunca_respondeu', 11, 15, '10:00'), ('nunca_respondeu', 12, 17, '10:00'), ('nunca_respondeu', 13, 20, '10:00'), ('nunca_respondeu', 14, 23, '10:00')
  ) as v(seq, etapa, du, hora)
 where g.sequencia = v.seq and g.etapa = v.etapa;

-- Na sequencia conversa a contagem de dias uteis parte do dia da ultima mensagem encadeada (agora a etapa 2, antes a 3).
create or replace function mayara.agenda_followup(p_seq text, p_ciclo timestamp with time zone)
returns table(etapa integer, devido_em timestamp with time zone)
language plpgsql stable set search_path to '' as $function$
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
