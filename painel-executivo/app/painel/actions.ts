'use server';

import { requireSession } from '@/lib/session';
import { revalidatePath } from 'next/cache';
import { desfazerPagamento, gravarArranjo, gravarMeta, gravarPagamento, gravarPrevisao, gravarTicketMedio } from '@/lib/painel-dados';
import { lerValorBR } from '@/lib/valor';

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

// Pagamento de parcela: exige sessao; dado invalido ou erro do banco so e registrado (a tela recarrega com o estado real).
export async function marcarPagaAction(formData: FormData): Promise<void> {
  await requireSession();
  try {
    await gravarPagamento(Number(formData.get('id')), String(formData.get('data') ?? ''));
  } catch (erro) {
    console.error('Falha ao marcar parcela como paga', erro);
  }
  revalidatePath('/painel');
}

export async function desfazerPagaAction(formData: FormData): Promise<void> {
  await requireSession();
  try {
    await desfazerPagamento(Number(formData.get('id')));
  } catch (erro) {
    console.error('Falha ao desfazer o pagamento da parcela', erro);
  }
  revalidatePath('/painel');
}

export async function definirMetaAction(formData: FormData): Promise<void> {
  await requireSession();
  try {
    const valor = lerValorBR(String(formData.get('valor') ?? ''));
    if (valor === null) throw new Error('valor ilegivel');
    await gravarMeta(String(formData.get('tipo') ?? ''), valor);
  } catch (erro) {
    console.error('Falha ao definir a meta do mes', erro);
  }
  revalidatePath('/painel');
}

export async function definirPrevisaoAction(formData: FormData): Promise<void> {
  await requireSession();
  try {
    const pct = lerValorBR(String(formData.get('chance') ?? '').replace('%', ''));
    if (pct === null) throw new Error('chance ilegivel');
    await gravarPrevisao(String(formData.get('etapa') ?? ''), pct / 100, Number(formData.get('prazo')));
  } catch (erro) {
    console.error('Falha ao definir a taxa da previsao', erro);
  }
  revalidatePath('/painel');
}

export async function definirTicketAction(formData: FormData): Promise<void> {
  await requireSession();
  try {
    const valor = lerValorBR(String(formData.get('valor') ?? ''));
    if (valor === null) throw new Error('valor ilegivel');
    await gravarTicketMedio(valor);
  } catch (erro) {
    console.error('Falha ao definir o valor medio de contrato', erro);
  }
  revalidatePath('/painel');
}
