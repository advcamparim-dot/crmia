export function chaveTelefone(telefone) {
  const d = String(telefone ?? '').replace(/\D/g, '');
  return /^55\d{10,11}$/.test(d) ? d.slice(2, 4) + d.slice(-8) : null;
}

export function normalizarTelefone(bruto) {
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

// As classes de caracteres abaixo sao montadas a partir de numeros (pares [inicio, fim] em hexadecimal)
// para que o codigo gerado nao tenha escape barra-u nem caractere invisivel literal: os dois se perdem
// ou se corrompem no transporte para o n8n.
function classe(pares) {
  return pares
    .map(([ini, fim]) => String.fromCharCode(ini) + (fim === undefined ? '' : '-' + String.fromCharCode(fim)))
    .join('');
}

const SURROGATE_ALTO = classe([[0xd800, 0xdbff]]);
const SURROGATE_BAIXO = classe([[0xdc00, 0xdfff]]);
const SURROGATE_SOLTO = new RegExp(
  '[' + SURROGATE_ALTO + '](?![' + SURROGATE_BAIXO + '])|(?<![' + SURROGATE_ALTO + '])[' + SURROGATE_BAIXO + ']',
  'g',
);
const ALTO_NO_FIM = new RegExp('[' + SURROGATE_ALTO + ']$');
const INVISIVEIS = new RegExp(
  '[' +
    classe([
      [0x0000, 0x001f], [0x007f, 0x009f], [0x00ad], [0x061c], [0x180e], [0x200b, 0x200f], [0x2028, 0x202e],
      [0x2060, 0x2064], [0x2066, 0x2069], [0x206a, 0x206f], [0xfff9, 0xfffb],
    ]) +
    ']',
  'g',
);
const TAGS = new RegExp('[' + String.fromCodePoint(0xe0000) + '-' + String.fromCodePoint(0xe007f) + ']', 'gu');
const MARCAS_COMBINANTES = new RegExp('[' + classe([[0x0300, 0x036f]]) + ']', 'g');
const NUL = new RegExp(classe([[0x0000]]), 'g');

function cortarAoMax(texto, max) {
  texto = texto.slice(0, max);
  return texto.replace(ALTO_NO_FIM, '').trimEnd();
}

export function sanitizarTexto(valor, max = 80) {
  if (typeof valor === 'number') valor = Number.isFinite(valor) ? String(valor) : '';
  if (typeof valor !== 'string') return '';
  return valor
    .replace(SURROGATE_SOLTO, ' ')
    .replace(INVISIVEIS, ' ')
    .replace(TAGS, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
    .replace(ALTO_NO_FIM, '')
    .trimEnd();
}

function normalizarChave(chave) {
  return String(chave)
    .normalize('NFD')
    .replace(MARCAS_COMBINANTES, '')
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

export function validarLead(payload) {
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
