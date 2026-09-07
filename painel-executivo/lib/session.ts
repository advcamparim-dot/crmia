import { createHmac, timingSafeEqual } from 'crypto';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

const COOKIE_NAME = 'painel_sessao';
const MAX_AGE_SECONDS = 60 * 60 * 12; // 12 horas

function getSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error('SESSION_SECRET não configurada');
  return secret;
}

export function signSession(): string {
  const issuedAt = Date.now().toString();
  const mac = createHmac('sha256', getSecret()).update(issuedAt).digest('hex');
  return `${issuedAt}.${mac}`;
}

export function verifySession(token: string): boolean {
  if (!token || !token.includes('.')) return false;
  const [issuedAt, mac] = token.split('.');
  const expectedMac = createHmac('sha256', getSecret()).update(issuedAt).digest('hex');
  if (mac.length !== expectedMac.length) return false;
  if (!timingSafeEqual(Buffer.from(mac), Buffer.from(expectedMac))) return false;
  const ageSeconds = (Date.now() - Number(issuedAt)) / 1000;
  return ageSeconds >= 0 && ageSeconds <= MAX_AGE_SECONDS;
}

export async function requireSession(): Promise<void> {
  const token = cookies().get(COOKIE_NAME)?.value ?? '';
  if (!verifySession(token)) {
    redirect('/login');
  }
}

export async function createSessionCookie(): Promise<void> {
  cookies().set(COOKIE_NAME, signSession(), {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: MAX_AGE_SECONDS,
    path: '/'
  });
}

export async function clearSessionCookie(): Promise<void> {
  cookies().delete(COOKIE_NAME);
}
