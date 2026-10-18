import { afterEach, describe, expect, it, vi } from 'vitest';

const query = vi.fn();
vi.mock('../../../lib/db', () => ({ getPool: () => ({ query }) }));

import { GET } from './route';

afterEach(() => {
  query.mockReset();
  vi.useRealTimers();
});

describe('GET /api/saude', () => {
  it('responde 200 {"banco":"ok"} quando o banco responde', async () => {
    query.mockResolvedValue({ rows: [{ '?column?': 1 }] });
    const r = await GET();
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ banco: 'ok' });
  });

  it('responde 503 {"banco":"falha"} sem vazar o erro, o host nem a versão', async () => {
    query.mockRejectedValue(new Error('connect ECONNREFUSED aws-1-exemplo.pooler.supabase.com:5432 senha=abc123'));
    const r = await GET();
    expect(r.status).toBe(503);
    const corpo = await r.text();
    expect(JSON.parse(corpo)).toEqual({ banco: 'falha' });
    expect(corpo).not.toMatch(/ECONNREFUSED|supabase|abc123|postgres/i);
  });

  it('responde 503 quando o banco não responde em 3 segundos', async () => {
    vi.useFakeTimers();
    query.mockReturnValue(new Promise(() => {})); // nunca resolve
    const resposta = GET();
    await vi.advanceTimersByTimeAsync(3100);
    const r = await resposta;
    expect(r.status).toBe(503);
    expect(await r.json()).toEqual({ banco: 'falha' });
  });
});
