import { describe, expect, it } from 'vitest';
import { lerValorBR } from './valor';

describe('lerValorBR', () => {
  it('entende as formas comuns em reais', () => {
    expect(lerValorBR('50000')).toBe(50000);
    expect(lerValorBR('50.000')).toBe(50000);
    expect(lerValorBR('50.000,50')).toBe(50000.5);
    expect(lerValorBR('R$ 1.234.567,89')).toBe(1234567.89);
    expect(lerValorBR('12,5')).toBe(12.5);
    expect(lerValorBR(' 10 ')).toBe(10);
    expect(lerValorBR('0')).toBe(0);
  });
  it('rejeita lixo e vazio', () => {
    for (const v of ['', 'abc', '1.2.3,4,5', '--5', '1e5', null, undefined]) expect(lerValorBR(v as string)).toBeNull();
  });
});
