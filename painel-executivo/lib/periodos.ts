// Períodos da barra do painel: Hoje, Ontem, Semana, Mês e Período livre, sempre em America/Sao_Paulo.
// Todos devolvem o intervalo [de, ate): `de` inclusivo, `ate` exclusivo. O relógio entra por parâmetro.
export type Preset = 'hoje' | 'ontem' | 'semana' | 'mes' | 'livre';

export interface PeriodoResolvido {
  de: Date;
  ate: Date;
  rotulo: string;
}

export interface PeriodoDaUrl extends PeriodoResolvido {
  preset: Preset;
}

const FUSO = 'America/Sao_Paulo';
const PRESETS: Preset[] = ['hoje', 'ontem', 'semana', 'mes', 'livre'];

const formatador = new Intl.DateTimeFormat('en-CA', {
  timeZone: FUSO,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23'
});

interface Partes {
  ano: number;
  mes: number;
  dia: number;
  hora: number;
}

function partesSP(instante: Date): Partes {
  const p = Object.fromEntries(formatador.formatToParts(instante).map((x) => [x.type, x.value]));
  return { ano: Number(p.year), mes: Number(p.month), dia: Number(p.day), hora: Number(p.hour) };
}

// Instante em que é 00:00 em São Paulo no dia civil (ano, mes, dia). O dia civil pode vir fora de faixa
// (dia 0, dia 32...): o Date.UTC normaliza.
function inicioDoDia(ano: number, mes: number, dia: number): Date {
  let chute = Date.UTC(ano, mes - 1, dia, 3, 0, 0);
  for (let i = 0; i < 3; i++) {
    const p = partesSP(new Date(chute));
    if (p.hora === 0) break;
    chute -= p.hora * 3_600_000;
  }
  return new Date(chute);
}

function diaDaSemana(ano: number, mes: number, dia: number): number {
  return new Date(Date.UTC(ano, mes - 1, dia)).getUTCDay(); // 0 = domingo
}

function ddmmaaaa(instante: Date): string {
  const p = partesSP(instante);
  return `${String(p.dia).padStart(2, '0')}/${String(p.mes).padStart(2, '0')}/${p.ano}`;
}

function lerData(texto: string | undefined): { ano: number; mes: number; dia: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(texto ?? '');
  if (!m) return null;
  const [ano, mes, dia] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const volta = new Date(Date.UTC(ano, mes - 1, dia));
  const real = volta.getUTCFullYear() === ano && volta.getUTCMonth() === mes - 1 && volta.getUTCDate() === dia;
  return real ? { ano, mes, dia } : null;
}

export function resolverPeriodo(
  preset: Preset,
  agora: Date,
  livre?: { de: string; ate: string }
): PeriodoResolvido {
  const hoje = partesSP(agora);

  if (preset === 'hoje') {
    return { de: inicioDoDia(hoje.ano, hoje.mes, hoje.dia), ate: inicioDoDia(hoje.ano, hoje.mes, hoje.dia + 1), rotulo: 'Hoje' };
  }
  if (preset === 'ontem') {
    return { de: inicioDoDia(hoje.ano, hoje.mes, hoje.dia - 1), ate: inicioDoDia(hoje.ano, hoje.mes, hoje.dia), rotulo: 'Ontem' };
  }
  if (preset === 'mes') {
    return { de: inicioDoDia(hoje.ano, hoje.mes, 1), ate: inicioDoDia(hoje.ano, hoje.mes, hoje.dia + 1), rotulo: 'Mês' };
  }
  if (preset === 'livre') {
    const a = lerData(livre?.de);
    const b = lerData(livre?.ate);
    if (a && b) {
      let de = inicioDoDia(a.ano, a.mes, a.dia);
      let ultimo = inicioDoDia(b.ano, b.mes, b.dia);
      if (de.getTime() > ultimo.getTime()) [de, ultimo] = [ultimo, de];
      const ate = inicioDoDia(partesSP(ultimo).ano, partesSP(ultimo).mes, partesSP(ultimo).dia + 1);
      return { de, ate, rotulo: `${ddmmaaaa(de)} a ${ddmmaaaa(ultimo)}` };
    }
    // período livre sem datas válidas: cai na semana
  }
  // semana: de segunda 00:00 até o fim de hoje
  const atrasoAteSegunda = (diaDaSemana(hoje.ano, hoje.mes, hoje.dia) + 6) % 7;
  return {
    de: inicioDoDia(hoje.ano, hoje.mes, hoje.dia - atrasoAteSegunda),
    ate: inicioDoDia(hoje.ano, hoje.mes, hoje.dia + 1),
    rotulo: 'Semana'
  };
}

export function lerPeriodoDaUrl(
  params: { periodo?: string; de?: string; ate?: string },
  agora: Date
): PeriodoDaUrl {
  const pedido = PRESETS.find((p) => p === params.periodo) ?? 'semana';
  const resolvido = resolverPeriodo(pedido, agora, { de: params.de ?? '', ate: params.ate ?? '' });
  // Se o período livre não tinha datas válidas, o resultado é a semana e o preset deve dizer a verdade.
  const preset: Preset = pedido === 'livre' && resolvido.rotulo === 'Semana' ? 'semana' : pedido;
  return { preset, ...resolvido };
}
