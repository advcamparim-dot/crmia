// gerar-receber-patch.mjs: operacoes incrementais para o "Canal: Receber Evolution" ao vivo.
// Marca cada mensagem como vista (idempotencia da recuperacao) e trata a mensagem humana com texto e data.
// Uso: node gerar-receber-patch.mjs  (grava receber-patch.json)
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { corpoNode, RODAPE_NORMALIZAR } from '../2026-10-03-camada-canal/gerar-receber.mjs';

const dir = dirname(fileURLToPath(import.meta.url));
const PG = { postgres: { id: 'nNpCUIhnDuVvTApU', name: 'Postgres account' } };
const nid = (n) => `cd000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const NORM = "$('Normalizar Evento').first().json";

export function operacoes() {
  const novos = [
    { id: nid(1), name: 'Marcar Vista', type: 'n8n-nodes-base.postgres', typeVersion: 2.6, position: [1320, 120], credentials: PG, onError: 'continueRegularOutput',
      parameters: { operation: 'executeQuery', query: "select mayara.marcar_mensagem_vista($1, $2, 'entrada', 'webhook') as novo",
        options: { queryReplacement: `={{ [${NORM}.evento.canalId, ${NORM}.evento.messageId] }}` } } },
    { id: nid(2), name: 'Marcar Vista Humano', type: 'n8n-nodes-base.postgres', typeVersion: 2.6, position: [1320, 340], credentials: PG, onError: 'continueRegularOutput',
      parameters: { operation: 'executeQuery', query: "select mayara.marcar_mensagem_vista($1, $2, 'saida_humana', 'webhook') as novo",
        options: { queryReplacement: `={{ [${NORM}.canalId, ${NORM}.messageId] }}` } } },
  ];
  return [
    { type: 'updateNode', nodeName: 'Normalizar Evento', updates: { 'parameters.jsCode': corpoNode(RODAPE_NORMALIZAR) } },
    ...novos.map((node) => ({ type: 'addNode', node })),
    { type: 'removeConnection', source: 'Registrar Aceito', target: 'Preparar Evento', sourceIndex: 0 },
    { type: 'addConnection', source: 'Registrar Aceito', target: 'Marcar Vista', sourceIndex: 0 },
    { type: 'addConnection', source: 'Marcar Vista', target: 'Preparar Evento', sourceIndex: 0 },
    { type: 'removeConnection', source: 'Humano?', target: 'Aguardar Registro de Envio', sourceIndex: 0 },
    { type: 'addConnection', source: 'Humano?', target: 'Marcar Vista Humano', branch: 'true' },
    { type: 'addConnection', source: 'Marcar Vista Humano', target: 'Aguardar Registro de Envio', sourceIndex: 0 },
    { type: 'updateNode', nodeName: 'Registrar Humano', updates: {
      'parameters.query': 'select mayara.tratar_mensagem_humana($1, $2, $3, $4, $5::timestamptz) as r',
      'parameters.options.queryReplacement': `={{ [${NORM}.canalId, ${NORM}.phone, ${NORM}.messageId, ${NORM}.texto, ${NORM}.timestamp] }}`,
    } },
  ];
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  writeFileSync(join(dir, 'receber-patch.json'), JSON.stringify(operacoes(), null, 2));
  console.log('receber-patch.json (' + operacoes().length + ' operacoes)');
}
