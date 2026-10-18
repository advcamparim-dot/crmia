import { getPool } from '../../../lib/db';

// Sempre consulta de verdade (nunca em cache) e nunca devolve detalhes do erro.
export const dynamic = 'force-dynamic';

const TIMEOUT_MS = 3000;

export async function GET(): Promise<Response> {
  let temporizador: ReturnType<typeof setTimeout> | undefined;
  try {
    const limite = new Promise<never>((_, rejeitar) => {
      temporizador = setTimeout(() => rejeitar(new Error('timeout')), TIMEOUT_MS);
    });
    await Promise.race([getPool().query('select 1'), limite]);
    return Response.json({ banco: 'ok' }, { status: 200 });
  } catch (erro) {
    console.error('Falha na verificação de saúde do banco', erro);
    return Response.json({ banco: 'falha' }, { status: 503 });
  } finally {
    if (temporizador) clearTimeout(temporizador);
  }
}
