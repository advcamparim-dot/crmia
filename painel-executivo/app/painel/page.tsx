import type { ReactNode } from 'react';
import { requireSession } from '@/lib/session';
import { logout } from '@/app/login/actions';
import { lerPeriodoDaUrl, type Preset } from '@/lib/periodos';
import { carregarPainel, lerArranjo } from '@/lib/painel-dados';
import type { WidgetId } from '@/lib/widgets';
import Grade from './Grade';
import { Kpi } from './widgets/Kpi';
import { Fila } from './widgets/Fila';
import { Etapas } from './widgets/Etapas';
import { Fontes } from './widgets/Fontes';
import { FollowupsDia } from './widgets/FollowupsDia';
import { TempoResposta } from './widgets/TempoResposta';
import { AnaliseFunil } from './widgets/AnaliseFunil';
import { ParcelasLista } from './widgets/ParcelasLista';
import { formatarReais } from './formatar';
import './styles.css';

const PRESETS: { chave: Exclude<Preset, 'livre'>; rotulo: string }[] = [
  { chave: 'hoje', rotulo: 'Hoje' },
  { chave: 'ontem', rotulo: 'Ontem' },
  { chave: 'semana', rotulo: 'Semana' },
  { chave: 'mes', rotulo: 'Mês' },
];

export default async function PainelPage({ searchParams }: { searchParams: { periodo?: string; de?: string; ate?: string } }) {
  await requireSession();

  const periodo = lerPeriodoDaUrl(searchParams, new Date());
  const [dados, arranjo] = await Promise.all([carregarPainel({ de: periodo.de, ate: periodo.ate }), lerArranjo()]);
  const n = dados.numeros;

  const quadros: Record<WidgetId, ReactNode> = {
    'kpi-leads-novos': <Kpi dados={n} valor={(x) => String(x.leads_novos)} />,
    'kpi-em-conversa': <Kpi dados={n} valor={(x) => String(x.em_conversa)} />,
    'kpi-sem-resposta': <Kpi dados={n} valor={(x) => String(x.sem_resposta)} />,
    'kpi-followups': <Kpi dados={n} valor={(x) => String(x.followups)} />,
    'kpi-consultas': <Kpi dados={n} valor={(x) => String(x.consultas)} />,
    'kpi-canal': <Kpi dados={n} valor={(x) => (x.canal === 'open' ? 'Conectado' : 'Desconectado')} alerta={(x) => x.canal !== 'open'} />,
    fila: <Fila fila={dados.fila} />,
    'leads-por-etapa': <Etapas etapas={dados.etapas} />,
    'followups-dia': <FollowupsDia followups={dados.followups} />,
    fontes: <Fontes fontes={dados.fontes} />,
    'tempo-resposta': <TempoResposta tempo={dados.tempo} />,
    'analise-funil': <AnaliseFunil funil={dados.funil} />,
    'kpi-contratos': <Kpi dados={dados.contratos} valor={(x) => String(x.fechados)} />,
    'kpi-receita-contratada': <Kpi dados={dados.contratos} valor={(x) => formatarReais(x.receita_contratada)} pequeno />,
    'kpi-receita-recebida': <Kpi dados={dados.contratos} valor={(x) => formatarReais(x.receita_recebida)} pequeno />,
    parcelas: <ParcelasLista parcelas={dados.parcelas} resumo={dados.contratos} />,
  };

  return (
    <div className="p-wrap">
      <div className="p-topo">
        <div className="p-marca">
          <img src="/logo-camparim.png" alt="Camparim Advogados" />
          <span>Camparim Advogados<small>Painel</small></span>
        </div>
        <nav className="p-periodos" aria-label="Período">
          {PRESETS.map((p) => (
            <a key={p.chave} href={`?periodo=${p.chave}`} className={`p-chip${periodo.preset === p.chave ? ' active' : ''}`}>{p.rotulo}</a>
          ))}
          <form method="get" className="p-livre">
            <input type="hidden" name="periodo" value="livre" />
            <input type="date" name="de" aria-label="De" required />
            <input type="date" name="ate" aria-label="Até" required />
            <button type="submit" className={`p-chip${periodo.preset === 'livre' ? ' active' : ''}`}>Período livre</button>
          </form>
        </nav>
        <form action={logout}>
          <button type="submit" className="p-sair" title="Sair">Sair</button>
        </form>
      </div>
      <p className="p-rotulo">{periodo.rotulo}</p>
      <Grade arranjo={arranjo} quadros={quadros} />
    </div>
  );
}
