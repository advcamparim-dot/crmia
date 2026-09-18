'use server';

import { createHmac, timingSafeEqual } from 'crypto';
import { redirect } from 'next/navigation';
import { createSessionCookie, clearSessionCookie } from '@/lib/session';

// HMAC both sides before comparing so the buffers are always equal-length,
// then compare in constant time. Avoids leaking the shared password via a
// timing side-channel on a plain `!==` string comparison.
function passwordMatches(input: string, expected: string): boolean {
  const key = 'painel-executivo-login-compare';
  const inputMac = createHmac('sha256', key).update(input).digest();
  const expectedMac = createHmac('sha256', key).update(expected).digest();
  return timingSafeEqual(inputMac, expectedMac);
}

export async function login(formData: FormData): Promise<void> {
  const senha = formData.get('senha');
  const painelSenha = process.env.PAINEL_SENHA;
  if (typeof senha !== 'string' || !painelSenha || !passwordMatches(senha, painelSenha)) {
    redirect('/login?erro=1');
  }
  await createSessionCookie();
  redirect('/painel-executivo');
}

export async function logout(): Promise<void> {
  await clearSessionCookie();
  redirect('/login');
}
