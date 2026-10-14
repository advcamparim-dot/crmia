// gerar-nodes.mjs: corpos dos Code nodes dos workflows de blindagem, a partir das bibliotecas testadas.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const sem = (arq) => readFileSync(arq, 'utf8').replace(/^export\s+/gm, '');
const vigia = sem(join(dir, 'vigia.mjs'));
const recuperar = sem(join(dir, 'recuperar.mjs'));
const evolucao = sem(join(dir, '..', '2026-10-03-camada-canal', 'evolucao.mjs'));
const CAB = '// Gerado por gerar-nodes.mjs a partir das bibliotecas testadas. Colar como esta.\n';

export const corpoVigia = [CAB, vigia,
  'const resposta = $input.first().json;',
  'return [{ json: { estado: estadoReal(resposta) } }];', ''].join('\n');

export const corpoJanela = [CAB, recuperar,
  "const e = $('Execute Workflow Trigger').first().json;",
  'const j = janelaBusca(e.desde, new Date().toISOString());',
  "return [{ json: { ...j, simular: String(e.simular || 'false') } }];", ''].join('\n');

export const corpoLote = [CAB, recuperar, evolucao,
  "const janela = $('Janela').first().json;",
  "const paginas = ['Buscar 1', 'Buscar 2', 'Buscar 3', 'Buscar 4'].filter((n) => $(n).isExecuted).map((n) => $(n).first().json);",
  'const status = statusBusca(paginas, janela, 200, 4);',
  'const todos = { records: paginas.flatMap((p) => extrairRegistros(p)) };',
  'const lote = prepararLote(todos, "escritorio", janela, 400);',
  'return lote.map((i) => {',
  "  if (i.fim) return { json: { fim: true, ateIso: i.ateIso, simular: janela.simular, completo: status.completo, motivo: status.motivo } };",
  '  const norm = normalizarEvolution(i.evento, "escritorio");',
  "  return { json: { fim: false, simular: janela.simular, messageId: i.evento.data.key.id, timestamp: i.timestamp, norm } };",
  '});', ''].join('\n');

export const corpoTextoAlerta = [CAB, vigia,
  "const r = $('Registrar Leitura').first().json.r;",
  'return [{ json: textoAlerta(r.acao, r.minutos_fora, r.tentativas) }];', ''].join('\n');

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  writeFileSync(join(dir, 'vigia.node.js'), corpoVigia);
  writeFileSync(join(dir, 'recuperar.node.js'), corpoJanela);
  writeFileSync(join(dir, 'normalizar-lote.node.js'), corpoLote);
  writeFileSync(join(dir, 'texto-alerta.node.js'), corpoTextoAlerta);
  console.log('corpos gerados');
}
