import { createHmac, randomBytes } from 'crypto';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { postgresSessionStore } from './session-store';

const COOKIE_NAME = 'painel_sessao';
const MAX_AGE_SECONDS = 60 * 60 * 12; // 12 horas

export interface SessionStore {
  create(hash: string, expiresAt: Date): Promise<void>;
  isValid(hash: string, now: Date): Promise<boolean>;
  revoke(hash: string, now: Date): Promise<void>;
}

function getSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error('SESSION_SECRET não configurada');
  return secret;
}

function hashSession(token: string): string {
  return createHmac('sha256', getSecret()).update(token).digest('hex');
}

export function createSessionService(store: SessionStore, now = () => new Date()) {
  return {
    async create(): Promise<string> {
      const token = randomBytes(32).toString('base64url');
      const issuedAt = now();
      const expiresAt = new Date(issuedAt.getTime() + MAX_AGE_SECONDS * 1000);
      await store.create(hashSession(token), expiresAt);
      return token;
    },

    async verify(token: string): Promise<boolean> {
      if (!token) return false;
      return store.isValid(hashSession(token), now());
    },

    async revoke(token: string): Promise<void> {
      if (!token) return;
      await store.revoke(hashSession(token), now());
    }
  };
}

const sessions = createSessionService(postgresSessionStore);

export const createSession = () => sessions.create();
export const verifySession = (token: string) => sessions.verify(token);
export const revokeSession = (token: string) => sessions.revoke(token);

export async function requireSession(): Promise<void> {
  const token = cookies().get(COOKIE_NAME)?.value ?? '';
  if (!(await verifySession(token))) {
    redirect('/login');
  }
}

export async function createSessionCookie(): Promise<void> {
  const token = await createSession();
  cookies().set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: MAX_AGE_SECONDS,
    path: '/'
  });
}

export async function revokeSessionCookie(): Promise<void> {
  await revokeSession(cookies().get(COOKIE_NAME)?.value ?? '');
  cookies().delete(COOKIE_NAME);
}
