export type LinhaPrevisao = {
  etapa: string; leads: number; chance: number; prazo_dias: number; esperados: number; ticket_medio: number; ticket_origem: string;
};
export type Horizonte = { dias: 20 | 40 | 60; contratos: number; receita: number };
export type ResumoPrevisao = { ativos: number; horizontes: Horizonte[]; ticket: number; origem: string };

const HORIZONTES = [20, 40, 60] as const;

// Cada etapa conta a partir do horizonte do seu prazo (20, 40 ou 60 dias) e nos seguintes.
export function resumirPrevisao(linhas: LinhaPrevisao[]): ResumoPrevisao {
  const ticket = linhas[0]?.ticket_medio ?? 0;
  return {
    ativos: linhas.reduce((s, l) => s + l.leads, 0),
    ticket,
    origem: linhas[0]?.ticket_origem ?? 'definido',
    horizontes: HORIZONTES.map((dias) => {
      const contratos = linhas.filter((l) => l.prazo_dias <= dias).reduce((s, l) => s + l.esperados, 0);
      return { dias, contratos, receita: contratos * ticket };
    }),
  };
}
