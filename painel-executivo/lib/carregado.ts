// Resultado de carregar um quadro: dado real ou "indisponivel". Falha de leitura nunca vira zero.
export type Carregado<T> = { estado: 'ok'; dados: T } | { estado: 'indisponivel' };

export const INDISPONIVEL = 'indisponível';

export async function carregar<T>(rotulo: string, fn: () => Promise<T>): Promise<Carregado<T>> {
  try {
    return { estado: 'ok', dados: await fn() };
  } catch (erro) {
    console.error(`Falha ao carregar ${rotulo}`, erro);
    return { estado: 'indisponivel' };
  }
}

export function texto<T>(c: Carregado<T>, formatar: (dados: T) => string): string {
  return c.estado === 'ok' ? formatar(c.dados) : INDISPONIVEL;
}
