export type PeriodPreset = 'hoje' | '7d' | '30d' | 'mes_atual';

export interface Period {
  from: Date;
  to: Date;
}

export function resolvePeriod(preset: PeriodPreset): Period {
  const to = new Date();
  const from = new Date(to);

  switch (preset) {
    case 'hoje':
      from.setHours(0, 0, 0, 0);
      break;
    case '7d':
      from.setDate(from.getDate() - 7);
      break;
    case '30d':
      from.setDate(from.getDate() - 30);
      break;
    case 'mes_atual':
      from.setDate(1);
      from.setHours(0, 0, 0, 0);
      break;
  }

  return { from, to };
}
