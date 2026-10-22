import { texto, type Carregado } from '@/lib/carregado';

export function Kpi<T>({ dados, valor, alerta, pequeno }: { dados: Carregado<T>; valor: (d: T) => string; alerta?: (d: T) => boolean; pequeno?: boolean }) {
  const emAlerta = dados.estado === 'ok' && alerta ? alerta(dados.dados) : false;
  return (
    <div className={`p-kpi${dados.estado === 'indisponivel' ? ' p-fora' : ''}${emAlerta ? ' p-alerta' : ''}${pequeno ? ' p-kpi-dinheiro' : ''}`}>
      <span className="p-kpi-valor">{texto(dados, valor)}</span>
    </div>
  );
}
