// Gerado por gerar-nodes.mjs a partir das bibliotecas testadas. Colar como esta.

// vigia.mjs
// Funcoes puras do vigia do canal. O corpo (sem export) e gerado para Code nodes do n8n por gerar-nodes.mjs.

function estadoReal(resposta) {
  if (!resposta || typeof resposta !== 'object') return 'inalcancavel';
  const estado = String((resposta.instance && resposta.instance.state) ?? resposta.state ?? '').toLowerCase();
  if (estado === 'open') return 'open';
  if (estado === 'connecting') return 'connecting';
  if (estado === 'close' || estado === 'closed' || estado === 'refused') return 'close';
  return 'inalcancavel';
}

function duracao(minutos) {
  const m = Math.max(0, Math.round(minutos));
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (h === 0) return m + ' minutos';
  return h + (h === 1 ? ' hora' : ' horas') + (r ? ' e ' + r + ' minutos' : '');
}

function textoAlerta(acao, minutosFora, tentativas) {
  const fora = duracao(minutosFora);
  const assunto = acao === 'lembrar' ? 'WhatsApp do escritório continua fora do ar' : 'WhatsApp do escritório fora do ar';
  const texto = [
    'O WhatsApp do escritório está fora do ar há ' + fora + '. A Mayara não recebe nem responde leads enquanto isso.',
    tentativas > 0 ? 'O sistema fez ' + tentativas + ' tentativas de reinício automático sem sucesso.' : 'O sistema não conseguiu falar com a Evolution.',
    'O que fazer: abra o painel da Evolution (instância escritorio) e use Conectar para ler o QR no celular do escritório.',
    'Quando a conexão voltar, o sistema busca sozinho as mensagens do período e registra o que foi respondido pelo celular. Mensagens recebidas durante a queda podem não ser recuperadas automaticamente; confira no celular se algum lead ficou sem resposta.',
  ].join('\n\n');
  return { assunto, texto };
}

const r = $('Registrar Leitura').first().json.r;
return [{ json: textoAlerta(r.acao, r.minutos_fora, r.tentativas) }];
