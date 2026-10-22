// Textos curtos para a tela. O fuso so importa em datas absolutas; aqui sao duracoes.
export function duracao(segundos: number): string {
  const s = Math.max(0, Math.round(segundos));
  if (s < 60) return `${s} s`;
  if (s < 3600) {
    const m = Math.floor(s / 60);
    const r = s % 60;
    return r === 0 ? `${m} min` : `${m} min ${r} s`;
  }
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

export function haQuanto(desde: Date, agora: Date = new Date()): string {
  const s = Math.max(0, Math.round((agora.getTime() - desde.getTime()) / 1000));
  if (s < 60) return 'agora há pouco';
  if (s < 3600) return `há ${Math.floor(s / 60)} min`;
  if (s < 86400) return `há ${Math.floor(s / 3600)} h`;
  return `há ${Math.floor(s / 86400)} d`;
}

export const ROTULO_TIPO: Record<string, string> = {
  lead_esperando: 'Lead esperando',
  transferencia: 'Transferência',
  agendamento_falhou: 'Agendamento falhou',
  consulta_24h: 'Consulta em 24 h',
  parcela_atrasada: 'Parcela atrasada',
  fim_sequencia: 'Fim da sequência',
  canal: 'WhatsApp',
};

export const ORIGEM_TIPO: Record<string, string> = {
  lead_esperando: 'Mayara',
  transferencia: 'WhatsApp',
  agendamento_falhou: 'Agenda',
  consulta_24h: 'Agenda',
  parcela_atrasada: 'Contratos',
  fim_sequencia: 'Follow-up',
  canal: 'WhatsApp',
};

export function formatarReais(valor: number): string {
  return 'R$ ' + valor.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function dataBR(iso: string): string {
  const [a, m, d] = iso.split('-');
  return `${d}/${m}/${a}`;
}

export function hojeIso(agora: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(agora);
}
