'use server';

import { createHmac, timingSafeEqual } from 'crypto';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { createSessionCookie, clearSessionCookie } from '@/lib/session';
import { createLoginGuard, clientKeyFromHeaders, type Limiter } from '@/lib/rate-limit';

// Limite de tentativas de login por IP (ultima entrada de x-forwarded-for) mais um teto global. O estado fica na memoria do processo: vale para uma
// unica instancia do painel (com varias replicas cada uma teria a propria contagem).
// Guardado em globalThis para sobreviver a modulos carregados mais de uma vez pelo Next.
const globalForLimiter = globalThis as unknown as { __painelLoginLimiter?: Limiter };
const loginLimiter = (globalForLimiter.__painelLoginLimiter ??= createLoginGuard());

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
  const chave = clientKeyFromHeaders((nome) => headers().get(nome));
  if (!loginLimiter.check(chave).allowed) {
    redirect('/login?erro=2');
  }
  const senha = formData.get('senha');
  const painelSenha = process.env.PAINEL_SENHA;
  if (typeof senha !== 'string' || !painelSenha || !passwordMatches(senha, painelSenha)) {
    loginLimiter.fail(chave);
    redirect('/login?erro=1');
  }
  loginLimiter.reset(chave);
  await createSessionCookie();
  redirect('/painel-executivo');
}

export async function logout(): Promise<void> {
  await clearSessionCookie();
  redirect('/login');
}
