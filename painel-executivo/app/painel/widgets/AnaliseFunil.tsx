import { texto, type Carregado } from '@/lib/carregado';
import type { FunilEtapa } from '@/lib/painel-dados';

export function AnaliseFunil({ funil }: { funil: Carregado<FunilEtapa[]> }) {
  if (funil.estado === 'indisponivel') return <p className="p-fora">{texto(funil, () => '')}</p>;
  return (
    <div>
      <table className="p-tabela">
        <thead>
          <tr><th>Etapa</th><th>Entraram</th><th>Avançaram</th><th>Perderam</th><th>Agora</th></tr>
        </thead>
        <tbody>
          {funil.dados.map((e) => (
            <tr key={e.etapa}>
              <td>{e.etapa}</td><td>{e.entraram}</td><td>{e.avancaram}</td>
              <td className={e.perderam > 0 ? 'p-alerta' : ''}>{e.perderam}</td><td>{e.agora}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="p-nota">Histórico disponível desde 06/10/2026. Datas de consulta, equipe e perda são aproximadas.</p>
    </div>
  );
}
