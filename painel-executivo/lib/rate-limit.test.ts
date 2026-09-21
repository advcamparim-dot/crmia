import { describe, it, expect } from 'vitest';
import { createLimiter, clientKeyFromHeaders } from './rate-limit';

const MINUTE = 60_000;

function fakeClock(start = 1_000_000) {
  let t = start;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
  };
}

describe('createLimiter', () => {
  it('permite uma chave sem falhas', () => {
    const clock = fakeClock();
    const limiter = createLimiter({ now: clock.now });
    expect(limiter.check('1.1.1.1')).toEqual({ allowed: true, retryAfterMs: 0 });
  });

  it('bloqueia a chave na quinta falha (padrao: 5 falhas em 15 minutos)', () => {
    const clock = fakeClock();
    const limiter = createLimiter({ now: clock.now });
    for (let i = 0; i < 4; i++) {
      limiter.fail('1.1.1.1');
      expect(limiter.check('1.1.1.1').allowed).toBe(true);
    }
    limiter.fail('1.1.1.1');
    const status = limiter.check('1.1.1.1');
    expect(status.allowed).toBe(false);
    expect(status.retryAfterMs).toBe(15 * MINUTE);
  });

  it('desbloqueia depois de 15 minutos', () => {
    const clock = fakeClock();
    const limiter = createLimiter({ now: clock.now });
    for (let i = 0; i < 5; i++) limiter.fail('1.1.1.1');
    expect(limiter.check('1.1.1.1').allowed).toBe(false);

    clock.advance(15 * MINUTE - 1);
    const quaseLa = limiter.check('1.1.1.1');
    expect(quaseLa.allowed).toBe(false);
    expect(quaseLa.retryAfterMs).toBe(1);

    clock.advance(1);
    expect(limiter.check('1.1.1.1')).toEqual({ allowed: true, retryAfterMs: 0 });
  });

  it('depois de desbloquear, a contagem de falhas recomeca do zero', () => {
    const clock = fakeClock();
    const limiter = createLimiter({ now: clock.now });
    for (let i = 0; i < 5; i++) limiter.fail('1.1.1.1');
    clock.advance(15 * MINUTE);
    for (let i = 0; i < 4; i++) limiter.fail('1.1.1.1');
    expect(limiter.check('1.1.1.1').allowed).toBe(true);
    limiter.fail('1.1.1.1');
    expect(limiter.check('1.1.1.1').allowed).toBe(false);
  });

  it('falhas fora da janela de 15 minutos nao se acumulam', () => {
    const clock = fakeClock();
    const limiter = createLimiter({ now: clock.now });
    for (let i = 0; i < 4; i++) limiter.fail('1.1.1.1');
    clock.advance(15 * MINUTE + 1);
    limiter.fail('1.1.1.1');
    expect(limiter.check('1.1.1.1').allowed).toBe(true);
  });

  it('reset (login com sucesso) zera as falhas da chave', () => {
    const clock = fakeClock();
    const limiter = createLimiter({ now: clock.now });
    for (let i = 0; i < 4; i++) limiter.fail('1.1.1.1');
    limiter.reset('1.1.1.1');
    for (let i = 0; i < 4; i++) limiter.fail('1.1.1.1');
    expect(limiter.check('1.1.1.1').allowed).toBe(true);
  });

  it('reset tambem libera uma chave bloqueada', () => {
    const clock = fakeClock();
    const limiter = createLimiter({ now: clock.now });
    for (let i = 0; i < 5; i++) limiter.fail('1.1.1.1');
    limiter.reset('1.1.1.1');
    expect(limiter.check('1.1.1.1').allowed).toBe(true);
  });

  it('falha registrada durante o bloqueio nao estende o bloqueio', () => {
    const clock = fakeClock();
    const limiter = createLimiter({ now: clock.now });
    for (let i = 0; i < 5; i++) limiter.fail('1.1.1.1');
    clock.advance(10 * MINUTE);
    limiter.fail('1.1.1.1');
    expect(limiter.check('1.1.1.1').retryAfterMs).toBe(5 * MINUTE);
  });

  it('chaves sao independentes', () => {
    const clock = fakeClock();
    const limiter = createLimiter({ now: clock.now });
    for (let i = 0; i < 5; i++) limiter.fail('1.1.1.1');
    expect(limiter.check('1.1.1.1').allowed).toBe(false);
    expect(limiter.check('2.2.2.2').allowed).toBe(true);
  });

  it('respeita max, windowMs e lockMs configurados', () => {
    const clock = fakeClock();
    const limiter = createLimiter({ max: 2, windowMs: MINUTE, lockMs: 2 * MINUTE, now: clock.now });
    limiter.fail('k');
    expect(limiter.check('k').allowed).toBe(true);
    limiter.fail('k');
    expect(limiter.check('k')).toEqual({ allowed: false, retryAfterMs: 2 * MINUTE });
    clock.advance(2 * MINUTE);
    expect(limiter.check('k').allowed).toBe(true);
  });

  it('limpa entradas antigas para a memoria nao crescer sem limite', () => {
    const clock = fakeClock();
    const limiter = createLimiter({ now: clock.now });
    for (let i = 0; i < 200; i++) limiter.fail(`ip-${i}`);
    for (let i = 0; i < 5; i++) limiter.fail('bloqueado');
    expect(limiter.size()).toBe(201);

    clock.advance(15 * MINUTE + 1);
    // qualquer operacao dispara a varredura
    limiter.check('qualquer');
    expect(limiter.size()).toBe(0);
  });

  it('a varredura preserva bloqueios ainda ativos e falhas ainda dentro da janela', () => {
    const clock = fakeClock();
    const limiter = createLimiter({ now: clock.now });
    for (let i = 0; i < 5; i++) limiter.fail('bloqueado');
    clock.advance(10 * MINUTE);
    limiter.fail('recente');
    clock.advance(6 * MINUTE); // 'bloqueado' ja expirou, 'recente' ainda esta na janela
    limiter.check('qualquer');
    expect(limiter.size()).toBe(1);
    expect(limiter.check('bloqueado').allowed).toBe(true);
  });

  it('limita o numero de chaves mesmo sem passar tempo (maxKeys)', () => {
    const clock = fakeClock();
    const limiter = createLimiter({ now: clock.now, maxKeys: 50 });
    for (let i = 0; i < 1000; i++) limiter.fail(`ip-${i}`);
    expect(limiter.size()).toBeLessThanOrEqual(50);
  });
});

describe('clientKeyFromHeaders', () => {
  const de = (h: Record<string, string>) => (name: string) => h[name] ?? null;

  it('usa a primeira entrada de x-forwarded-for', () => {
    expect(clientKeyFromHeaders(de({ 'x-forwarded-for': '203.0.113.7, 10.0.0.1, 10.0.0.2' }))).toBe('203.0.113.7');
  });

  it('aceita uma unica entrada e aparas espacos', () => {
    expect(clientKeyFromHeaders(de({ 'x-forwarded-for': '  203.0.113.7  ' }))).toBe('203.0.113.7');
  });

  it('cai para x-real-ip quando nao ha x-forwarded-for', () => {
    expect(clientKeyFromHeaders(de({ 'x-real-ip': '198.51.100.9' }))).toBe('198.51.100.9');
  });

  it('cai para x-real-ip quando x-forwarded-for esta vazio', () => {
    expect(clientKeyFromHeaders(de({ 'x-forwarded-for': ' , ', 'x-real-ip': '198.51.100.9' }))).toBe('198.51.100.9');
  });

  it('cai para uma constante quando nao ha nenhum dos dois', () => {
    expect(clientKeyFromHeaders(de({}))).toBe('desconhecido');
  });

  it('corta valores enormes para nao inflar a memoria', () => {
    const key = clientKeyFromHeaders(de({ 'x-forwarded-for': 'a'.repeat(5000) }));
    expect(key.length).toBeLessThanOrEqual(64);
  });
});
