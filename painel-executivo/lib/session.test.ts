import { describe, it, expect } from 'vitest';
import { signSession, verifySession } from './session';

describe('session', () => {
  it('verifica uma sessão recém-assinada como válida', () => {
    const token = signSession();
    expect(verifySession(token)).toBe(true);
  });

  it('rejeita um token adulterado', () => {
    const token = signSession();
    const adulterado = token.slice(0, -1) + (token.at(-1) === 'a' ? 'b' : 'a');
    expect(verifySession(adulterado)).toBe(false);
  });

  it('rejeita um token vazio', () => {
    expect(verifySession('')).toBe(false);
  });
});
