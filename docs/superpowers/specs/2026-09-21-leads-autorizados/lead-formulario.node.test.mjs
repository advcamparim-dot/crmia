import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gerarCorpoDoNode } from './gerar-node.mjs';
import { validarLead } from './lead-formulario.mjs';

const arquivo = new URL('./lead-formulario.node.js', import.meta.url);

// Roda o corpo gerado com um $input arbitrario (para simular first() quebrado).
function rodarComInput($input) {
  const corpo = readFileSync(arquivo, 'utf8');
  const fn = new Function('$input', corpo);
  return fn($input)[0].json;
}

function rodarNode(entrada) {
  return rodarComInput({ first: () => ({ json: entrada }) });
}

// Corpo minimo valido; os testes acrescentam campos a ele.
function lead(extra) {
  return { nome: 'Ana', telefone: '(11) 99999-0001', ...extra };
}

// Todos os caracteres especiais deste arquivo sao escritos como escapes \uXXXX, nunca literais.
const PAR = '\ud83d\ude00';

// Igual ao detector do teste da biblioteca (por codepoint, cobre o plano astral), mais o NUL
// (ja coberto por c <= 0x08), o U+FFFD (que aparece quando um surrogate solto e gravado em UTF-8)
// e qualquer surrogate solto.
function invisiveisLiterais(texto) {
  const achados = [];
  for (const ch of texto) {
    const c = ch.codePointAt(0);
    if (c <= 0x08 || c === 0x0b || c === 0x0c || (c >= 0x0e && c <= 0x1f) || (c >= 0x7f && c <= 0x9f) ||
        c === 0xad || c === 0x61c || c === 0x180e || (c >= 0x200b && c <= 0x200f) || (c >= 0x2028 && c <= 0x202e) ||
        (c >= 0x2060 && c <= 0x2064) || (c >= 0x2066 && c <= 0x206f) || (c >= 0x300 && c <= 0x36f) ||
        c === 0xfeff || c === 0xfffd || (c >= 0xfff9 && c <= 0xfffb) || (c >= 0xd800 && c <= 0xdfff) ||
        (c >= 0xe0000 && c <= 0xe007f)) {
      achados.push('U+' + c.toString(16).toUpperCase().padStart(4, '0'));
    }
  }
  return achados;
}

// JSON.stringify escreve um surrogate solto como uma sequencia de escape barra-u-d-XXX e o NUL como
// barra-u-0000; um par valido sai como o proprio caractere. Portanto qualquer escape entre d800 e dfff
// no JSON e um surrogate solto.
function temEscapeProibido(json) {
  return /\\u0000/.test(json) || /\\ud[89a-f][0-9a-f]{2}/i.test(json);
}

// ============ deriva e comportamento basico ============

test('o arquivo do node e exatamente o que o gerador produz (sem deriva)', () => {
  assert.equal(readFileSync(arquivo, 'utf8'), gerarCorpoDoNode());
});

// O transporte para o n8n corrompe escape barra-u de caractere nao ASCII e caractere invisivel literal.
// O node gerado nao pode ter nenhum dos dois. As faixas abaixo sao numeros, nunca literais.
const FAIXAS_PROIBIDAS = [
  [0x00ad, 0x00ad], [0x061c, 0x061c], [0x180e, 0x180e], [0x200b, 0x200f], [0x2028, 0x202e],
  [0x2060, 0x206f], [0xfff9, 0xfffb], [0x0300, 0x036f], [0xe0000, 0xe007f],
];

test('o node gerado nao tem caractere invisivel literal', () => {
  const corpo = readFileSync(arquivo, 'utf8');
  const achados = [];
  for (const ch of corpo) {
    const c = ch.codePointAt(0);
    if (FAIXAS_PROIBIDAS.some(([ini, fim]) => c >= ini && c <= fim)) achados.push(c.toString(16));
  }
  assert.deepEqual(achados, []);
});

test('o node gerado nao tem escape barra-u de codepoint a partir de U+00A0', () => {
  const corpo = readFileSync(arquivo, 'utf8');
  const barraU = String.fromCharCode(0x5c) + 'u';
  const achados = [];
  let i = corpo.indexOf(barraU);
  while (i !== -1) {
    const resto = corpo.slice(i + 2);
    const chaves = /^\{([0-9a-fA-F]+)\}/.exec(resto);
    const quatro = /^([0-9a-fA-F]{4})/.exec(resto);
    const valor = chaves ? parseInt(chaves[1], 16) : quatro ? parseInt(quatro[1], 16) : 0;
    if (valor >= 0xa0) achados.push(valor.toString(16));
    i = corpo.indexOf(barraU, i + 2);
  }
  assert.deepEqual(achados, []);
});

test('o node valido igual a biblioteca, com e sem o envelope body', () => {
  const payload = { Nome: 'Teste Silva', Telefone: '(11) 99999-0001', Tipo: 'Capital de Giro' };
  const esperado = validarLead(payload);
  for (const entrada of [{ body: payload }, payload]) {
    const saida = rodarNode(entrada);
    assert.equal(saida.ok, true);
    assert.equal(saida.telefone, esperado.lead.telefone);
    assert.equal(saida.telefoneChave, esperado.lead.telefoneChave);
    assert.deepEqual(saida.fatos, esperado.lead.fatos);
    assert.deepEqual(saida.payloadBruto, payload);
  }
});

test('o node devolve ok false com motivo para telefone invalido e payload invalido', () => {
  assert.equal(rodarNode({ body: { nome: 'A', telefone: '1' } }).motivo, 'telefone_invalido');
  assert.equal(rodarNode({ body: 'texto' }).motivo, 'campo_invalido');
});

test('o corpo gerado e um corpo de funcao: sem import, export nem require', () => {
  const corpo = readFileSync(arquivo, 'utf8');
  assert.doesNotMatch(corpo, /^\s*(export|import)\b/m);
  assert.doesNotMatch(corpo, /\brequire\s*\(/);
  assert.doesNotMatch(corpo, /\bimport\s*\(/);
});

// ============ payloadBruto limpo para o Postgres ============

test('payloadBruto: remove NUL de string em objeto aninhado, em array e em chave', () => {
  const saida = rodarNode({
    body: lead({
      obs: { detalhe: { texto: 'ab\u0000cd' } },
      lista: ['x\u0000y', 'ok', ['\u0000z']],
      'k\u0000ey': 'v',
    }),
  });
  assert.equal(saida.ok, true);
  assert.deepEqual(saida.payloadBruto, {
    nome: 'Ana',
    telefone: '(11) 99999-0001',
    obs: { detalhe: { texto: 'abcd' } },
    lista: ['xy', 'ok', ['z']],
    key: 'v',
  });
});

test('payloadBruto: remove surrogate solto e preserva o par valido', () => {
  assert.equal(PAR, '\u{1F600}');
  const saida = rodarNode({
    body: lead({
      alto: 'a\ud800b',
      baixo: 'a\udc00b',
      par: 'a' + PAR + 'b',
      altoNoFim: 'x\ud83d',
      baixoNoInicio: '\ude00x',
      altoAntesDoPar: 'x\ud800' + PAR + 'y',
      baixoDepoisDoPar: 'x' + PAR + '\udc00y',
      lista: ['\ud800', PAR, '\udc00'],
    }),
  });
  assert.deepEqual(saida.payloadBruto, {
    nome: 'Ana',
    telefone: '(11) 99999-0001',
    alto: 'ab',
    baixo: 'ab',
    par: 'a\u{1F600}b',
    altoNoFim: 'x',
    baixoNoInicio: 'x',
    altoAntesDoPar: 'x\u{1F600}y',
    baixoDepoisDoPar: 'x\u{1F600}y',
    lista: ['', '\u{1F600}', ''],
  });
});

test('payloadBruto: corpo ja limpo sai igual ao de entrada, mas como copia profunda', () => {
  const corpo = lead({ aninhado: { lista: [1, 'dois', { tres: 3 }] }, n: 1.5, t: true, f: false, z: null });
  const saida = rodarNode({ body: corpo });
  assert.deepEqual(saida.payloadBruto, corpo);
  assert.notEqual(saida.payloadBruto, corpo);
  assert.notEqual(saida.payloadBruto.aninhado, corpo.aninhado);
  assert.notEqual(saida.payloadBruto.aninhado.lista, corpo.aninhado.lista);
  corpo.aninhado.lista.push('depois');
  assert.equal(saida.payloadBruto.aninhado.lista.length, 3);
});

test('payloadBruto: o validarLead recebe o corpo original, so o payloadBruto e limpo', () => {
  const corpo = lead({ nome: 'Ana\u0000Silva' });
  const saida = rodarNode({ body: corpo });
  assert.equal(saida.ok, true);
  assert.equal(saida.nome, validarLead(corpo).lead.nome);
  assert.equal(saida.nome, 'Ana Silva');
  assert.equal(saida.payloadBruto.nome, 'AnaSilva');
});

test('payloadBruto: string na raiz tambem e limpa (ramo ok false)', () => {
  const saida = rodarNode({ body: 'a\u0000\ud800b' + PAR });
  assert.deepEqual(saida, { ok: false, motivo: 'campo_invalido', payloadBruto: 'ab\u{1F600}' });
});

test('payloadBruto: profundidade acima de 6 vira null (a raiz e o nivel 0)', () => {
  // A chave aK guarda o valor do nivel K.
  const saida = rodarNode({
    body: lead({ a1: { a2: { a3: { a4: { a5: { a6: { a7: 'fundo' } } } } } } }),
  });
  assert.deepEqual(saida.payloadBruto.a1, { a2: { a3: { a4: { a5: { a6: { a7: null } } } } } });

  // No nivel 6 o objeto e mantido; o que esta abaixo dele, mesmo um objeto inteiro, vira null.
  const saida2 = rodarNode({
    body: lead({ a1: { a2: { a3: { a4: { a5: { a6: { a7: { a8: 1 }, b7: [1, 2] } } } } } } }),
  });
  assert.deepEqual(saida2.payloadBruto.a1, { a2: { a3: { a4: { a5: { a6: { a7: null, b7: null } } } } } });

  // Um valor simples no nivel 6 e mantido.
  const saida3 = rodarNode({ body: lead({ a1: { a2: { a3: { a4: { a5: { a6: 'seis' } } } } } }) });
  assert.deepEqual(saida3.payloadBruto.a1, { a2: { a3: { a4: { a5: { a6: 'seis' } } } } });

  // Em array o nivel conta do mesmo jeito (o array externo e o nivel 1).
  const saida4 = rodarNode({ body: lead({ l: [[[[['x', ['y']]]]]] }) });
  assert.deepEqual(saida4.payloadBruto.l, [[[[['x', [null]]]]]]);
  const saida5 = rodarNode({ body: lead({ l: [[[[[['x']]]]]] }) });
  assert.deepEqual(saida5.payloadBruto.l, [[[[[[null]]]]]]);
});

test('payloadBruto: objeto circular nao trava, nao lanca e sai sem ciclo', () => {
  const corpo = lead({});
  corpo.self = corpo;
  const saida = rodarNode({ body: corpo });
  assert.equal(saida.ok, true);
  let no = saida.payloadBruto;
  for (let nivel = 0; nivel < 5; nivel++) no = no.self;
  // No nivel 5 os valores ainda passam; o objeto do nivel 6 e mantido, mas o que esta abaixo dele
  // (nivel 7) vira null.
  assert.equal(no.nome, 'Ana');
  assert.deepEqual(no.self, { nome: null, telefone: null, self: null });
  assert.doesNotThrow(() => JSON.stringify(saida));
});

test('payloadBruto: no maximo 200 chaves por objeto e 200 itens por array', () => {
  const chaves200 = {};
  const chaves250 = {};
  for (let i = 0; i < 250; i++) {
    if (i < 200) chaves200['k' + i] = i;
    chaves250['k' + i] = i;
  }
  const saida = rodarNode({
    body: lead({
      chaves200,
      chaves250,
      itens200: Array.from({ length: 200 }, (_, i) => i),
      itens250: Array.from({ length: 250 }, (_, i) => i),
    }),
  });
  assert.equal(saida.ok, true);
  assert.equal(Object.keys(saida.payloadBruto.chaves200).length, 200);
  assert.equal(Object.keys(saida.payloadBruto.chaves250).length, 200);
  assert.equal(Object.keys(saida.payloadBruto.chaves250)[199], 'k199');
  assert.equal(saida.payloadBruto.chaves250.k199, 199);
  assert.equal(saida.payloadBruto.chaves250.k200, undefined);
  assert.equal(saida.payloadBruto.itens200.length, 200);
  assert.equal(saida.payloadBruto.itens250.length, 200);
  assert.equal(saida.payloadBruto.itens250[199], 199);

  // O limite vale tambem para o objeto da raiz, e o lead continua sendo montado com o corpo original.
  const largo = lead({});
  for (let i = 0; i < 250; i++) largo['x' + i] = i;
  const saidaLarga = rodarNode({ body: largo });
  assert.equal(saidaLarga.ok, true);
  assert.equal(Object.keys(saidaLarga.payloadBruto).length, 200);
  assert.equal(saidaLarga.nome, 'Ana');
});

test('payloadBruto: tipos que nao sao JSON viram null; numero, booleano e null passam iguais', () => {
  const saida = rodarNode({
    body: lead({
      indef: undefined,
      funcao: () => 1,
      simbolo: Symbol('s'),
      grande: 10n,
      data: new Date(0),
      mapa: new Map([[1, 2]]),
      num: 1.5,
      zero: 0,
      neg: -3,
      verdade: true,
      falso: false,
      nulo: null,
      lista: [undefined, () => 1, Symbol('s'), 10n, 2, true, null, 'x'],
    }),
  });
  assert.equal(saida.ok, true);
  assert.deepEqual(saida.payloadBruto, {
    nome: 'Ana',
    telefone: '(11) 99999-0001',
    indef: null,
    funcao: null,
    simbolo: null,
    grande: null,
    data: null,
    mapa: null,
    num: 1.5,
    zero: 0,
    neg: -3,
    verdade: true,
    falso: false,
    nulo: null,
    lista: [null, null, null, null, 2, true, null, 'x'],
  });
});

test('payloadBruto: a chave __proto__ vinda de um JSON continua sendo dado, sem mexer no prototipo', () => {
  const corpo = JSON.parse('{"nome":"Ana","telefone":"(11) 99999-0001","__proto__":{"x":1}}');
  const saida = rodarNode({ body: corpo });
  assert.equal(saida.ok, true);
  assert.equal(Object.getPrototypeOf(saida.payloadBruto), Object.prototype);
  assert.equal(Object.prototype.hasOwnProperty.call(saida.payloadBruto, '__proto__'), true);
  assert.deepEqual(Object.getOwnPropertyDescriptor(saida.payloadBruto, '__proto__').value, { x: 1 });
  assert.equal(saida.payloadBruto.x, undefined);
});

test('payloadBruto: varios NUL e varios surrogates soltos na mesma string saem todos limpos', () => {
  const saida = rodarNode({
    body: lead({
      nuls: 'a\u0000b\u0000c',
      soltos: 'x\ud800y\ud800z\udc00',
      entreSoltos: 'a\ud800b\ud800' + PAR + 'c\udc00d\udc00',
      misto: '\u0000\ud800\u0000' + PAR + '\udc00\u0000',
      'k\u0000e\u0000y\ud800\ud800': 'v',
      lista: ['1\u00002\u00003', 'p\ud800q\ud800r'],
    }),
  });
  assert.deepEqual(saida.payloadBruto, {
    nome: 'Ana',
    telefone: '(11) 99999-0001',
    nuls: 'abc',
    soltos: 'xyz',
    entreSoltos: 'ab\u{1F600}cd',
    misto: '\u{1F600}',
    key: 'v',
    lista: ['123', 'pqr'],
  });
});

test('payloadBruto: getter que lanca em um item de array vira null so naquele item', () => {
  const lista = ['antes', 'x', 'depois'];
  Object.defineProperty(lista, 1, {
    get() {
      throw new Error('boom');
    },
    enumerable: true,
    configurable: true,
  });
  let saida;
  assert.doesNotThrow(() => {
    saida = rodarNode({ body: lead({ lista }) });
  });
  assert.equal(saida.ok, true);
  assert.deepEqual(saida.payloadBruto.lista, ['antes', null, 'depois']);
});

test('payloadBruto: corpo raiz que e array tem no maximo 200 itens', () => {
  const itens = Array.from({ length: 201 }, (_, i) => i);
  const saida = rodarNode({ body: itens });
  assert.equal(saida.ok, false);
  assert.equal(saida.motivo, 'campo_invalido');
  assert.equal(saida.payloadBruto.length, 200);
  assert.deepEqual(saida.payloadBruto, itens.slice(0, 200));
  const exatos = rodarNode({ body: itens.slice(0, 200) });
  assert.equal(exatos.payloadBruto.length, 200);
  assert.deepEqual(exatos.payloadBruto, itens.slice(0, 200));
});

test('payloadBruto: NaN e Infinity passam como numeros (o JSON os serializa como null)', () => {
  const saida = rodarNode({ body: lead({ nan: NaN, inf: Infinity, ninf: -Infinity, lista: [NaN, Infinity] }) });
  assert.equal(saida.ok, true);
  assert.deepEqual(saida.payloadBruto, {
    nome: 'Ana',
    telefone: '(11) 99999-0001',
    nan: NaN,
    inf: Infinity,
    ninf: -Infinity,
    lista: [NaN, Infinity],
  });
  assert.equal(
    JSON.stringify(saida.payloadBruto),
    '{"nome":"Ana","telefone":"(11) 99999-0001","nan":null,"inf":null,"ninf":null,"lista":[null,null]}',
  );
});

test('envelope: body presente mas undefined ou null e campo_invalido; sem a chave body usa o proprio item', () => {
  assert.deepEqual(rodarNode({ body: undefined }), { ok: false, motivo: 'campo_invalido', payloadBruto: null });
  assert.deepEqual(rodarNode({ body: null }), { ok: false, motivo: 'campo_invalido', payloadBruto: null });
  const item = lead({});
  const saida = rodarNode(item);
  assert.equal(saida.ok, true);
  assert.equal(saida.nome, 'Ana');
  assert.deepEqual(saida.payloadBruto, item);
});

test('payloadBruto: chaves herdadas por prototype nao entram, so as proprias', () => {
  const corpo = Object.create({ herdada: 1 });
  corpo.nome = 'Ana';
  corpo.telefone = '(11) 99999-0001';
  corpo.aninhado = Object.assign(Object.create({ herdadaFilha: 2 }), { propria: 3 });
  const saida = rodarNode({ body: corpo });
  assert.equal(saida.ok, true);
  assert.deepEqual(saida.payloadBruto, {
    nome: 'Ana',
    telefone: '(11) 99999-0001',
    aninhado: { propria: 3 },
  });
  assert.equal(Object.prototype.hasOwnProperty.call(saida.payloadBruto, 'herdada'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(saida.payloadBruto.aninhado, 'herdadaFilha'), false);
});

// ============ corpo hostil: o node nunca lanca ============

test('corpo hostil: getter que lanca no corpo devolve campo_invalido com o resto limpo', () => {
  const hostil = {
    nome: 'x',
    get ruim() {
      throw new Error('boom');
    },
  };
  let saida;
  assert.doesNotThrow(() => {
    saida = rodarNode({ body: hostil });
  });
  assert.deepEqual(saida, { ok: false, motivo: 'campo_invalido', payloadBruto: { nome: 'x', ruim: null } });
});

test('corpo hostil: getter que lanca em objeto aninhado vira null e o lead segue valido', () => {
  const corpo = lead({
    aninhado: {
      get ruim() {
        throw new Error('boom');
      },
      ok: 'y',
    },
  });
  let saida;
  assert.doesNotThrow(() => {
    saida = rodarNode({ body: corpo });
  });
  assert.equal(saida.ok, true);
  assert.deepEqual(saida.payloadBruto.aninhado, { ruim: null, ok: 'y' });
});

test('corpo hostil: proxy que lanca ao listar chaves ou ja revogado devolve campo_invalido e payloadBruto null', () => {
  const proxyQueLanca = new Proxy({}, {
    ownKeys() {
      throw new Error('boom');
    },
  });
  const revogavel = Proxy.revocable({}, {});
  revogavel.revoke();
  for (const hostil of [proxyQueLanca, revogavel.proxy]) {
    let saida;
    assert.doesNotThrow(() => {
      saida = rodarNode({ body: hostil });
    });
    assert.deepEqual(saida, { ok: false, motivo: 'campo_invalido', payloadBruto: null });
  }
});

test('corpo hostil: getter que lanca no proprio envelope body devolve campo_invalido e payloadBruto null', () => {
  const envelope = {
    get body() {
      throw new Error('boom');
    },
  };
  let saida;
  assert.doesNotThrow(() => {
    saida = rodarNode(envelope);
  });
  assert.deepEqual(saida, { ok: false, motivo: 'campo_invalido', payloadBruto: null });
});

test('item de entrada hostil: first() sem item, que lanca ou com json em getter que lanca nao faz o node lancar', () => {
  const esperado = { ok: false, motivo: 'campo_invalido', payloadBruto: null };
  const casos = {
    'first devolve undefined': { first: () => undefined },
    'first devolve null': { first: () => null },
    'first lanca': {
      first: () => {
        throw new Error('x');
      },
    },
    'json e getter que lanca': {
      first: () => ({
        get json() {
          throw new Error('x');
        },
      }),
    },
    'json undefined': { first: () => ({}) },
    'first nao e funcao': {},
    '$input undefined': undefined,
  };
  for (const [nome, input] of Object.entries(casos)) {
    let saida;
    assert.doesNotThrow(() => {
      saida = rodarComInput(input);
    }, nome);
    assert.deepEqual(saida, esperado, nome);
  }
});

// ============ o resultado inteiro serializa sem o que o Postgres recusa ============

test('o detector de escapes proibidos realmente detecta (controle negativo)', () => {
  assert.equal(temEscapeProibido(JSON.stringify({ a: 'x\u0000' })), true);
  assert.equal(temEscapeProibido(JSON.stringify({ a: 'x\ud800' })), true);
  assert.equal(temEscapeProibido(JSON.stringify({ a: 'x\udc00' })), true);
  assert.equal(temEscapeProibido(JSON.stringify({ a: 'x' + PAR })), false);
  assert.equal(temEscapeProibido(JSON.stringify({ a: 'x' })), false);
});

test('o resultado do node serializa sem escape de NUL nem de surrogate solto, nos dois ramos', () => {
  const sujo = {
    Nome: 'Ana\u0000Silva\ud800',
    Telefone: '(11) 99999-0001',
    Email: 'a\u0000@b.co\udc00',
    Empresa: '\udc00Acme' + PAR,
    'k\u0000ey\ud800': 'v\udc00',
    lista: ['\u0000', '\udc00', PAR],
    fundo: { a: { b: { c: 'x\u0000\ud800' } } },
  };

  const ok = rodarNode({ body: sujo });
  assert.equal(ok.ok, true);
  const jsonOk = JSON.stringify(ok);
  assert.equal(temEscapeProibido(jsonOk), false);
  assert.equal(jsonOk.includes(PAR), true);

  const invalidoTelefone = rodarNode({ body: { ...sujo, Telefone: '1' } });
  assert.equal(invalidoTelefone.motivo, 'telefone_invalido');
  assert.equal(temEscapeProibido(JSON.stringify(invalidoTelefone)), false);

  const invalidoCorpo = rodarNode({ body: 'a\u0000\ud800\udc00\udc00' });
  assert.equal(invalidoCorpo.motivo, 'campo_invalido');
  assert.equal(temEscapeProibido(JSON.stringify(invalidoCorpo)), false);
});

// ============ guarda de caracteres invisiveis ============

test('guarda: o detector encontra NUL, surrogate solto, U+FFFD e astral', () => {
  assert.deepEqual(invisiveisLiterais('a\u0000b'), ['U+0000']);
  assert.deepEqual(invisiveisLiterais('a\ud800b'), ['U+D800']);
  assert.deepEqual(invisiveisLiterais('a\udc00b'), ['U+DC00']);
  assert.deepEqual(invisiveisLiterais('a\ufffdb'), ['U+FFFD']);
  assert.deepEqual(invisiveisLiterais('a\u{E0041}b'), ['U+E0041']);
  assert.deepEqual(invisiveisLiterais('a\u200bb'), ['U+200B']);
  assert.deepEqual(invisiveisLiterais('normal ' + PAR + '\n\t'), []);
});

for (const nome of ['gerar-node.mjs', 'lead-formulario.node.js', 'lead-formulario.node.test.mjs']) {
  test('guarda: ' + nome + ' sem invisivel literal', () => {
    const conteudo = readFileSync(new URL('./' + nome, import.meta.url), 'utf8');
    const encontrados = invisiveisLiterais(conteudo);
    assert.deepEqual(encontrados, [], nome + ': ' + encontrados.length + ' invisivel(is): ' + encontrados.join(', '));
  });

  test('guarda: ' + nome + ' e ASCII puro', () => {
    const conteudo = readFileSync(new URL('./' + nome, import.meta.url), 'utf8');
    assert.equal(/^[\x00-\x7f]*$/.test(conteudo), true, nome + ' tem caractere fora de ASCII');
  });
}
