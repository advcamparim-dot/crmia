import { describe, it, expect } from 'vitest';
import { createSessionService, revokeThenClear, type SessionStore } from './session';

function memoryStore(): SessionStore & { revoked: string[] } {
  const active = new Map<string, Date>();
  const revoked: string[] = [];
  return {
    revoked,
    async create(hash, expiresAt) { active.set(hash, expiresAt); },
    async isValid(hash, now) { return (active.get(hash)?.getTime() ?? 0) > now.getTime() && !revoked.includes(hash); },
    async revoke(hash) { revoked.push(hash); }
  };
}

describe('session', () => {
  it('verifica uma sessão recém-criada como válida', async () => {
    const service = createSessionService(memoryStore());
    const token = await service.create();
    await expect(service.verify(token)).resolves.toBe(true);
  });

  it('rejeita um token adulterado', async () => {
    const service = createSessionService(memoryStore());
    const token = await service.create();
    const adulterado = token.slice(0, -1) + (token.at(-1) === 'a' ? 'b' : 'a');
    await expect(service.verify(adulterado)).resolves.toBe(false);
  });

  it('rejeita token revogado', async () => {
    const store = memoryStore();
    const service = createSessionService(store);
    const token = await service.create();
    await service.revoke(token);
    await expect(service.verify(token)).resolves.toBe(false);
    expect(store.revoked).toHaveLength(1);
  });

  it('rejeita token expirado', async () => {
    let agora = new Date('2026-10-18T12:00:00Z');
    const service = createSessionService(memoryStore(), () => agora);
    const token = await service.create();
    agora = new Date('2026-10-19T01:00:01Z');
    await expect(service.verify(token)).resolves.toBe(false);
  });

  it('revoga no servidor antes de apagar o cookie', async () => {
    const eventos: string[] = [];

    await revokeThenClear(
      'token',
      async () => { eventos.push('revogar'); },
      () => { eventos.push('apagar-cookie'); }
    );

    expect(eventos).toEqual(['revogar', 'apagar-cookie']);
  });

  it('rejeita um token vazio', async () => {
    const service = createSessionService(memoryStore());
    await expect(service.verify('')).resolves.toBe(false);
  });
});
