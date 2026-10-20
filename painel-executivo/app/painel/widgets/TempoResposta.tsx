import { texto, type Carregado } from '@/lib/carregado';
import type { TempoResposta as Tempo } from '@/lib/painel-dados';
import { duracao } from '../formatar';

export function TempoResposta({ tempo }: { tempo: Carregado<Tempo> }) {
  if (tempo.estado === 'indisponivel') return <p className="p-fora">{texto(tempo, () => '')}</p>;
  const t = tempo.dados;
  return (
    <dl className="p-pares">
      <div><dt>Média da Mayara</dt><dd>{t.media_segundos === null ? 'sem dados' : duracao(t.media_segundos)}</dd></div>
      <div><dt>Maior espera agora</dt><dd>{t.maior_espera_segundos === null ? 'ninguém esperando' : duracao(t.maior_espera_segundos)}</dd></div>
    </dl>
  );
}
