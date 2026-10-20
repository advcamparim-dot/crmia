// Patch do workflow "Avisar Falha de Agendamento" (2Z3f0Ka1aOsuRwr8): alem de avisar o administrador e criar a Task no
// EspoCRM, registra a falha em painel.falhas_agendamento para a fila "Precisa de voce" do painel.
export const NOME_NO = 'Registrar Falha no Painel';
const RAMO = 'Falha Tecnica?';

export function aplicarPatch(workflow) {
  const wf = structuredClone(workflow);
  const ramo = wf.connections?.[RAMO]?.main?.[0];
  if (!Array.isArray(ramo)) throw new Error(`o workflow nao tem o ramo verdadeiro de "${RAMO}"`);

  if (!wf.nodes.some((n) => n.name === NOME_NO)) {
    wf.nodes.push({
      id: 'e7000000-0000-4000-8000-000000000001',
      name: NOME_NO,
      type: 'n8n-nodes-base.postgres',
      typeVersion: 2.6,
      position: [480, 300],
      onError: 'continueRegularOutput',
      parameters: {
        operation: 'executeQuery',
        query: 'select painel.registrar_falha_agendamento($1, $2) as id',
        options: {
          queryReplacement: "={{ [ ($json.sessionId || '').split(':')[2] || '', $json.motivoFalha || '' ] }}",
        },
      },
      credentials: { postgres: { id: 'nNpCUIhnDuVvTApU', name: 'Postgres account' } },
    });
  }
  if (!ramo.some((c) => c.node === NOME_NO)) ramo.push({ node: NOME_NO, type: 'main', index: 0 });
  return wf;
}
