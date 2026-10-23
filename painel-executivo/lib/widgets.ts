// Catalogo dos quadros da tela inicial. Tamanhos em unidades da grade de 12 colunas.
export type WidgetId =
  | 'kpi-leads-novos'
  | 'kpi-em-conversa'
  | 'kpi-sem-resposta'
  | 'kpi-followups'
  | 'kpi-consultas'
  | 'kpi-canal'
  | 'fila'
  | 'leads-por-etapa'
  | 'followups-dia'
  | 'fontes'
  | 'tempo-resposta'
  | 'analise-funil'
  | 'kpi-contratos'
  | 'kpi-receita-contratada'
  | 'kpi-receita-recebida'
  | 'parcelas'
  | 'metas'
  | 'previsao'
  | 'reativacao';

export const CATALOGO: Record<WidgetId, { titulo: string; w: number; h: number }> = {
  'kpi-leads-novos': { titulo: 'Leads novos', w: 2, h: 2 },
  'kpi-em-conversa': { titulo: 'Em conversa', w: 2, h: 2 },
  'kpi-sem-resposta': { titulo: 'Sem resposta', w: 2, h: 2 },
  'kpi-followups': { titulo: 'Follow-ups', w: 2, h: 2 },
  'kpi-consultas': { titulo: 'Consultas', w: 2, h: 2 },
  'kpi-canal': { titulo: 'WhatsApp', w: 2, h: 2 },
  fila: { titulo: 'Precisa de você', w: 7, h: 9 },
  'leads-por-etapa': { titulo: 'Leads por etapa', w: 5, h: 5 },
  'followups-dia': { titulo: 'Follow-ups do período', w: 5, h: 4 },
  fontes: { titulo: 'Fontes de lead', w: 6, h: 5 },
  'tempo-resposta': { titulo: 'Tempo de resposta', w: 6, h: 5 },
  'analise-funil': { titulo: 'Análise do funil', w: 12, h: 4 },
  'kpi-contratos': { titulo: 'Contratos fechados', w: 3, h: 2 },
  'kpi-receita-contratada': { titulo: 'Receita contratada', w: 4, h: 2 },
  'kpi-receita-recebida': { titulo: 'Receita recebida', w: 5, h: 2 },
  parcelas: { titulo: 'Parcelas', w: 12, h: 8 },
  metas: { titulo: 'Metas do mês', w: 12, h: 7 },
  reativacao: { titulo: 'Reativação de leads frios', w: 12, h: 6 },
  previsao: { titulo: 'Vendas em potencial (previsão)', w: 12, h: 8 },
};

export const IDS_DO_CATALOGO = Object.keys(CATALOGO) as WidgetId[];

export function ehWidgetId(valor: unknown): valor is WidgetId {
  return typeof valor === 'string' && Object.prototype.hasOwnProperty.call(CATALOGO, valor);
}
