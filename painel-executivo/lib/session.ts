import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { criarSessao, revogarSessao, validarSessao, DURACAO_SESSAO_MS } from './sessao';

const COOKIE_NAME = 'painel_sessao';

export async function requireSession(): Promise<void> {
  const token = cookies().get(COOKIE_NAME)?.value ?? '';
  if (!(await validarSessao(token))) {
    redirect('/login');
  }
}

export async function createSessionCookie(): Promise<void> {
  const token = await criarSessao();
  cookies().set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: DURACAO_SESSAO_MS / 1000,
    path: '/'
  });
}

export async function clearSessionCookie(): Promise<void> {
  const token = cookies().get(COOKIE_NAME)?.value ?? '';
  try {
    await revogarSessao(token);
  } catch (erro) {
    console.error('Falha ao revogar a sessão no logout', erro);
  }
  cookies().delete(COOKIE_NAME);
}
