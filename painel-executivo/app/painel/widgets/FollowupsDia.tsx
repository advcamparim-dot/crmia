import { texto, type Carregado } from '@/lib/carregado';
import type { FollowupsPeriodo } from '@/lib/painel-dados';

export function FollowupsDia({ followups }: { followups: Carregado<FollowupsPeriodo> }) {
  if (followups.estado === 'indisponivel') return <p className="p-fora">{texto(followups, () => '')}</p>;
  const f = followups.dados;
  return (
    <dl className="p-pares">
      <div><dt>Enviados</dt><dd>{f.enviados}</dd></div>
      <div><dt>Responderam depois</dt><dd>{f.respostas}</dd></div>
      <div><dt>Falhas</dt><dd className={f.falhas > 0 ? 'p-alerta' : ''}>{f.falhas}</dd></div>
    </dl>
  );
}
