'use server';

import { requireSession } from '@/lib/session';
import { gravarArranjo } from '@/lib/painel-dados';

export async function salvarArranjo(arranjo: unknown): Promise<{ ok: boolean }> {
  await requireSession();
  try {
    await gravarArranjo(arranjo);
    return { ok: true };
  } catch (erro) {
    console.error('Falha ao salvar o arranjo dos quadros', erro);
    return { ok: false };
  }
}
