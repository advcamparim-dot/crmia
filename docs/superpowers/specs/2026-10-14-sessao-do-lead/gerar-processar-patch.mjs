// gerar-processar-patch.mjs: operacoes incrementais para o "Canal: Processar Evento" ao vivo.
// Troca a chave de sessao do evento pela sessao canonica do lead (com ou sem o nono digito) antes da portaria.
// Uso: node gerar-processar-patch.mjs  (grava processar-patch.json)
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const PG = { postgres: { id: 'nNpCUIhnDuVvTApU', name: 'Postgres account' } };
const nid = (n) => `5e550000-0000-4000-8000-${String(n).padStart(12, '0')}`;

export function operacoes() {
  const novos = [
    { id: nid(1), name: 'Resolver Sessão', type: 'n8n-nodes-base.postgres', typeVersion: 2.6, position: [1700, 300], credentials: PG, onError: 'continueRegularOutput',
      parameters: { operation: 'executeQuery', query: 'select mayara.com_sessao_canonica($1::jsonb) as evento',
        options: { queryReplacement: '={{ [JSON.stringify($json)] }}' } } },
    { id: nid(2), name: 'Aplicar Sessão', type: 'n8n-nodes-base.code', typeVersion: 2, position: [1900, 300],
      parameters: { jsCode: "const e = $json.evento;\nif (e && typeof e === 'object' && !Array.isArray(e)) return [{ json: e }];\nreturn [{ json: $('Execute Workflow Trigger').first().json }];" } },
  ];
  return [
    ...novos.map((node) => ({ type: 'addNode', node })),
    { type: 'removeConnection', source: 'Restaurar Evento', target: 'Evento Autorizado?', sourceIndex: 0 },
    { type: 'removeConnection', source: 'Tem Mensagem?', target: 'Evento Autorizado?', sourceIndex: 1 },
    { type: 'addConnection', source: 'Restaurar Evento', target: 'Resolver Sessão', sourceIndex: 0 },
    { type: 'addConnection', source: 'Tem Mensagem?', target: 'Resolver Sessão', sourceIndex: 1 },
    { type: 'addConnection', source: 'Resolver Sessão', target: 'Aplicar Sessão', sourceIndex: 0 },
    { type: 'addConnection', source: 'Aplicar Sessão', target: 'Evento Autorizado?', sourceIndex: 0 },
  ];
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  writeFileSync(join(dir, 'processar-patch.json'), JSON.stringify(operacoes(), null, 2));
  console.log('processar-patch.json (' + operacoes().length + ' operacoes)');
}
