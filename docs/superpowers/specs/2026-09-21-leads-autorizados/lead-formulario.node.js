function chaveTelefone(telefone) {
  const d = String(telefone ?? '').replace(/\D/g, '');
  return /^55\d{10,11}$/.test(d) ? d.slice(2, 4) + d.slice(-8) : null;
}

function normalizarTelefone(bruto) {
  const invalido = { ok: false, motivo: 'telefone_invalido' };
  if (typeof bruto !== 'string' && typeof bruto !== 'number') return invalido;
  const texto = String(bruto).trim();
  let d = texto.replace(/\D/g, '').replace(/^0+/, '');
  if (texto.startsWith('+') && !d.startsWith('55')) return invalido;
  if (d.startsWith('55') && (d.length === 12 || d.length === 13)) d = d.slice(2);
  else if (d.length !== 10 && d.length !== 11) return invalido;
  const ddd = d.slice(0, 2);
  const numero = d.slice(2);
  if (!/^[1-9][1-9]$/.test(ddd)) return invalido;
  if (numero.length === 9 && !numero.startsWith('9')) return invalido;
  if (numero.length === 8 && !/^[6-9]/.test(numero)) return invalido;
  const telefone = '+55' + d;
  return { ok: true, telefone, chave: chaveTelefone(telefone) };
}

function cortarAoMax(texto, max) {
  texto = texto.slice(0, max);
  return texto.replace(/[\ud800-\udbff]$/, '').trimEnd();
}

function sanitizarTexto(valor, max = 80) {
  if (typeof valor === 'number') valor = Number.isFinite(valor) ? String(valor) : '';
  if (typeof valor !== 'string') return '';
  return valor
    .replace(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g, ' ')
    .replace(/[\u0000-\u001f\u007f-\u009f\u00ad\u061c\u180e\u200b-\u200f\u2028-\u202e\u2060-\u2064\u2066-\u2069\u206a-\u206f\ufff9-\ufffb]/g, ' ')
    .replace(/[\u{E0000}-\u{E007F}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
    .replace(/[\ud800-\udbff]$/, '')
    .trimEnd();
}

function normalizarChave(chave) {
  return String(chave)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

const ALIASES = {
  nome: ['nome', 'name', 'full_name', 'nome_completo'],
  telefone: ['telefone', 'phone', 'celular', 'whatsapp', 'phone_number', 'fone', 'telefone_whatsapp'],
  email: ['email', 'e_mail'],
  empresa: ['empresa', 'company', 'razao_social', 'nome_da_empresa'],
  idCampanha: ['id_campanha', 'campanha', 'campaign', 'campaign_id', 'utm_campaign'],
  ondeDivida: ['onde_esta_a_divida', 'onde_esta_divida', 'divida_em'],
  valor: ['valor_da_divida', 'valor', 'valor_divida'],
  situacao: ['situacao'],
  tipo: ['tipo', 'tipo_de_divida', 'tipo_divida'],
};

function extrairCampos(payload) {
  const mapaListas = new Map();
  for (const [chave, valor] of Object.entries(payload)) {
    const chaveNorm = normalizarChave(chave);
    if (!mapaListas.has(chaveNorm)) {
      mapaListas.set(chaveNorm, []);
    }
    mapaListas.get(chaveNorm).push(valor);
  }
  const pegar = (aliases, max) => {
    for (const alias of aliases) {
      const valores = mapaListas.get(alias) || [];
      for (let i = valores.length - 1; i >= 0; i--) {
        const texto = sanitizarTexto(valores[i], max);
        if (texto) return texto;
      }
    }
    return '';
  };
  let telefoneSelecionado = '';
  let primeiroNaoVazio = '';
  for (const alias of ALIASES.telefone) {
    const valores = mapaListas.get(alias) || [];
    for (let i = valores.length - 1; i >= 0; i--) {
      const valor = valores[i];
      if (valor !== undefined && valor !== null && valor !== '') {
        if (!primeiroNaoVazio) primeiroNaoVazio = valor;
        const resultado = normalizarTelefone(valor);
        if (resultado.ok) {
          telefoneSelecionado = valor;
          break;
        }
      }
    }
    if (telefoneSelecionado) break;
  }
  if (!telefoneSelecionado) telefoneSelecionado = primeiroNaoVazio;
  return {
    nome: pegar(ALIASES.nome, 120),
    telefone: telefoneSelecionado,
    email: pegar(ALIASES.email, 120),
    empresa: pegar(ALIASES.empresa, 120),
    idCampanha: pegar(ALIASES.idCampanha, 80),
    ondeDivida: pegar(ALIASES.ondeDivida, 80),
    valor: pegar(ALIASES.valor, 80),
    situacao: pegar(ALIASES.situacao, 120),
    tipo: pegar(ALIASES.tipo, 80),
  };
}

function mapearDocumento(texto) {
  const t = normalizarChave(texto);
  if (t.includes('ambos') || (t.includes('cnpj') && t.includes('cpf')) || (t.includes('fisica') && t.includes('juridica'))) return 'ambos';
  if (t.includes('cnpj') || t.includes('juridica')) return 'CNPJ';
  if (t.includes('cpf') || t.includes('fisica')) return 'CPF';
  return '';
}

function validarLead(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return { ok: false, motivo: 'campo_invalido' };
  let c;
  try {
    c = extrairCampos(payload);
  } catch {
    return { ok: false, motivo: 'campo_invalido' };
  }
  const tel = normalizarTelefone(c.telefone);
  if (!tel.ok) return { ok: false, motivo: 'telefone_invalido' };
  let email = sanitizarTexto(c.email, 120);
  email = email.toLowerCase();
  email = cortarAoMax(email, 120);
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    email = '';
  }
  const fatos = { telefone: tel.telefone, origemLead: 'formulario' };
  if (c.nome) fatos.nomeCompleto = c.nome;
  if (c.empresa) fatos.nomeEmpresa = c.empresa;
  if (email) fatos.email = email;
  if (c.tipo) fatos.tipoDivida = c.tipo;
  if (c.valor) fatos.valorAproximado = c.valor;
  const documento = mapearDocumento(c.ondeDivida);
  if (documento) fatos.documento = documento;
  if (c.situacao) fatos.situacaoFormulario = c.situacao;
  return {
    ok: true,
    lead: {
      telefone: tel.telefone,
      telefoneChave: tel.chave,
      nome: c.nome,
      email,
      empresa: c.empresa,
      idCampanha: c.idCampanha,
      fatos,
    },
  };
}

// ---- cola do Code node (gerada por gerar-node.mjs; nao editar o arquivo gerado) ----
// O payloadBruto segue para colunas text/jsonb do Postgres, que recusam o caractere NUL e surrogate
// solto. limparParaBanco devolve uma COPIA profunda segura:
// - strings (e chaves) sem NUL e sem surrogate solto; o par valido fica;
// - arrays e objetos comuns limpos recursivamente, com no maximo 200 itens/chaves cada;
// - profundidade maxima 6 (a raiz e o nivel 0; qualquer valor no nivel 7 ou abaixo vira null);
// - numero, booleano e null passam iguais; todo o resto (undefined, funcao, symbol, bigint, Date,
//   Map...) vira null.
// Nunca lanca excecao.
function limparTextoParaBanco(texto) {
  return texto
    .replace(/\u0000/g, '')
    .replace(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g, '');
}

function limparParaBanco(valor, profundidade) {
  try {
    if (profundidade > 6) return null;
    if (valor === null) return null;
    if (typeof valor === 'string') return limparTextoParaBanco(valor);
    if (typeof valor === 'number' || typeof valor === 'boolean') return valor;
    if (typeof valor !== 'object') return null;
    if (Array.isArray(valor)) {
      const itens = [];
      const total = Math.min(valor.length, 200);
      for (let i = 0; i < total; i++) {
        let item = null;
        try {
          item = valor[i];
        } catch {
          item = null;
        }
        itens.push(limparParaBanco(item, profundidade + 1));
      }
      return itens;
    }
    if (Object.prototype.toString.call(valor) !== '[object Object]') return null;
    const pares = [];
    for (const chave of Object.keys(valor).slice(0, 200)) {
      let filho = null;
      try {
        filho = valor[chave];
      } catch {
        filho = null;
      }
      pares.push([limparTextoParaBanco(chave), limparParaBanco(filho, profundidade + 1)]);
    }
    return Object.fromEntries(pares);
  } catch {
    return null;
  }
}

let entrada;
let payloadBruto = null;
let r = { ok: false, motivo: 'campo_invalido' };
try {
  // A leitura do item fica DENTRO do try: first() sem item, first() que lanca ou json em getter que
  // lanca tambem viram campo_invalido com payloadBruto null, em vez de derrubar o node.
  entrada = $input.first().json;
  const corpo = entrada && typeof entrada === 'object' && 'body' in entrada ? entrada.body : entrada;
  payloadBruto = limparParaBanco(corpo, 0);
  r = validarLead(corpo);
} catch {
  // Item ou corpo hostil (getter ou proxy que lanca): segue como campo_invalido, sem lancar.
}
if (!r.ok) return [{ json: { ok: false, motivo: r.motivo, payloadBruto } }];
return [{ json: { ok: true, ...r.lead, payloadBruto } }];
