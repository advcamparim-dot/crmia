'use server';

import { redirect } from 'next/navigation';
import { createSessionCookie, clearSessionCookie } from '@/lib/session';

export async function login(formData: FormData): Promise<void> {
  const senha = formData.get('senha');
  if (senha !== process.env.PAINEL_SENHA) {
    redirect('/login?erro=1');
  }
  await createSessionCookie();
  redirect('/painel-executivo');
}

export async function logout(): Promise<void> {
  await clearSessionCookie();
  redirect('/login');
}
