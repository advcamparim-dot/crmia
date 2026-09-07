import { describe, it, expect } from 'vitest';
import { resolvePeriod } from './period';

describe('resolvePeriod', () => {
  it('"hoje" cobre só o dia corrente', () => {
    const { from, to } = resolvePeriod('hoje');
    expect(from.toDateString()).toBe(new Date().toDateString());
    expect(to.getTime()).toBeGreaterThanOrEqual(from.getTime());
  });

  it('"30d" cobre 30 dias até agora', () => {
    const { from, to } = resolvePeriod('30d');
    const diffDays = (to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24);
    expect(Math.round(diffDays)).toBe(30);
  });
});
