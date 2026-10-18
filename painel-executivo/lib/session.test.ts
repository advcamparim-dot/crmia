import { describe, it, expect } from 'vitest';
import { createSessionService, type SessionStore } from './session';

function memoryStore(): SessionStore & { revoked: string[] } {
  const active = new Set<string>();
  const revoked: string[] = [];
  return {
    revoked,
    async create(hash) { active.add(hash); },
    async isValid(hash) { return active.has(hash) && !revoked.includes(hash); },
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

  it('rejeita um token vazio', async () => {
    const service = createSessionService(memoryStore());
    await expect(service.verify('')).resolves.toBe(false);
  });
});
