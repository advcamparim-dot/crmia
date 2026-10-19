import { describe, expect, it } from 'vitest';
import { lerPeriodoDaUrl, resolverPeriodo } from './periodos';

// São Paulo está em UTC-3 o ano todo: 00:00 em São Paulo = 03:00Z.
const iso = (d: Date) => d.toISOString();
const SEG_MEIO_DIA = new Date('2026-10-19T15:00:00Z'); // segunda 19/10/2026, 12:00 em São Paulo

describe('resolverPeriodo', () => {
  it('hoje vai de 00:00 a 24:00 de São Paulo', () => {
    const p = resolverPeriodo('hoje', SEG_MEIO_DIA);
    expect(iso(p.de)).toBe('2026-10-19T03:00:00.000Z');
    expect(iso(p.ate)).toBe('2026-10-20T03:00:00.000Z');
    expect(p.rotulo).toBe('Hoje');
  });

  it('a fronteira é a meia-noite de São Paulo, não a de UTC', () => {
    // 23:59 de 19/10 em São Paulo ainda é "hoje 19/10"; um minuto depois já é 20/10.
    expect(iso(resolverPeriodo('hoje', new Date('2026-10-20T02:59:00Z')).de)).toBe('2026-10-19T03:00:00.000Z');
    expect(iso(resolverPeriodo('hoje', new Date('2026-10-20T03:01:00Z')).de)).toBe('2026-10-20T03:00:00.000Z');
  });

  it('ontem é o dia anterior completo', () => {
    const p = resolverPeriodo('ontem', SEG_MEIO_DIA);
    expect(iso(p.de)).toBe('2026-10-18T03:00:00.000Z');
    expect(iso(p.ate)).toBe('2026-10-19T03:00:00.000Z');
    expect(p.rotulo).toBe('Ontem');
  });

  it('semana começa na segunda 00:00 e vai até o fim de hoje', () => {
    const p = resolverPeriodo('semana', new Date('2026-10-21T15:00:00Z')); // quarta
    expect(iso(p.de)).toBe('2026-10-19T03:00:00.000Z');
    expect(iso(p.ate)).toBe('2026-10-22T03:00:00.000Z');
    expect(p.rotulo).toBe('Semana');
  });

  it('semana, quando hoje é domingo, começa na segunda anterior', () => {
    const p = resolverPeriodo('semana', new Date('2026-10-18T15:00:00Z')); // domingo
    expect(iso(p.de)).toBe('2026-10-12T03:00:00.000Z');
    expect(iso(p.ate)).toBe('2026-10-19T03:00:00.000Z');
  });

  it('mes começa no dia 1 e funciona na virada de mês e de ano', () => {
    // 31/10 23:30 em São Paulo (já é 01/11 em UTC): continua outubro.
    expect(iso(resolverPeriodo('mes', new Date('2026-11-01T02:30:00Z')).de)).toBe('2026-10-01T03:00:00.000Z');
    // 31/12 22:00 em São Paulo (já é 01/01 em UTC): continua dezembro de 2026.
    expect(iso(resolverPeriodo('mes', new Date('2027-01-01T01:00:00Z')).de)).toBe('2026-12-01T03:00:00.000Z');
    expect(iso(resolverPeriodo('mes', new Date('2027-01-05T15:00:00Z')).de)).toBe('2027-01-01T03:00:00.000Z');
    expect(resolverPeriodo('mes', SEG_MEIO_DIA).rotulo).toBe('Mês');
  });

  it('livre usa as datas dadas e o "ate" é inclusivo (vira o início do dia seguinte)', () => {
    const p = resolverPeriodo('livre', SEG_MEIO_DIA, { de: '2026-10-01', ate: '2026-10-15' });
    expect(iso(p.de)).toBe('2026-10-01T03:00:00.000Z');
    expect(iso(p.ate)).toBe('2026-10-16T03:00:00.000Z');
    expect(p.rotulo).toBe('01/10/2026 a 15/10/2026');
  });

  it('livre com datas invertidas troca de e ate', () => {
    const p = resolverPeriodo('livre', SEG_MEIO_DIA, { de: '2026-10-15', ate: '2026-10-01' });
    expect(iso(p.de)).toBe('2026-10-01T03:00:00.000Z');
    expect(iso(p.ate)).toBe('2026-10-16T03:00:00.000Z');
  });

  it('livre inválido ou ausente cai em semana', () => {
    const semana = resolverPeriodo('semana', SEG_MEIO_DIA);
    for (const livre of [undefined, { de: 'abc', ate: '2026-10-15' }, { de: '2026-02-30', ate: '2026-03-02' }, { de: '', ate: '' }]) {
      const p = resolverPeriodo('livre', SEG_MEIO_DIA, livre);
      expect(iso(p.de)).toBe(iso(semana.de));
      expect(iso(p.ate)).toBe(iso(semana.ate));
    }
  });
});

describe('lerPeriodoDaUrl', () => {
  it('valor desconhecido ou ausente devolve semana', () => {
    expect(lerPeriodoDaUrl({}, SEG_MEIO_DIA).preset).toBe('semana');
    expect(lerPeriodoDaUrl({ periodo: 'xyz' }, SEG_MEIO_DIA).preset).toBe('semana');
    expect(lerPeriodoDaUrl({ periodo: '30d' }, SEG_MEIO_DIA).preset).toBe('semana');
  });

  it('lê cada preset conhecido', () => {
    for (const preset of ['hoje', 'ontem', 'semana', 'mes'] as const) {
      expect(lerPeriodoDaUrl({ periodo: preset }, SEG_MEIO_DIA).preset).toBe(preset);
    }
  });

  it('livre com datas válidas é aceito; sem datas cai em semana', () => {
    const ok = lerPeriodoDaUrl({ periodo: 'livre', de: '2026-10-01', ate: '2026-10-15' }, SEG_MEIO_DIA);
    expect(ok.preset).toBe('livre');
    expect(iso(ok.de)).toBe('2026-10-01T03:00:00.000Z');
    expect(lerPeriodoDaUrl({ periodo: 'livre' }, SEG_MEIO_DIA).preset).toBe('semana');
  });
});
