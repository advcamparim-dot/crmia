import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chaveTelefone, normalizarTelefone, sanitizarTexto, validarLead } from './lead-formulario.mjs';
import { readFileSync } from 'node:fs';

// Helper: Detect invisible characters using codePointAt (supports astral plane)
function invisiveisLiterais(texto) {
  const achados = [];
  for (const ch of texto) {
    const c = ch.codePointAt(0);
    if (c <= 0x08 || c === 0x0b || c === 0x0c || (c >= 0x0e && c <= 0x1f) || (c >= 0x7f && c <= 0x9f) ||
        c === 0xad || c === 0x61c || c === 0x180e || (c >= 0x200b && c <= 0x200f) || (c >= 0x2028 && c <= 0x202e) ||
        (c >= 0x2060 && c <= 0x2064) || (c >= 0x2066 && c <= 0x206f) || (c >= 0x300 && c <= 0x36f) ||
        c === 0xfeff || (c >= 0xfff9 && c <= 0xfffb) || (c >= 0xe0000 && c <= 0xe007f)) {
      achados.push('U+' + c.toString(16).toUpperCase().padStart(4, '0'));
    }
  }
  return achados;
}

// ============ chaveTelefone e normalizarTelefone ============

test('chaveTelefone: mesma chave com e sem nono digito, e igual a funcao SQL', () => {
  assert.equal(chaveTelefone('+5514997022609'), '1497022609');
  assert.equal(chaveTelefone('+551497022609'), '1497022609');
  assert.equal(chaveTelefone('+55 (14) 99702-2609'), '1497022609');
  assert.equal(chaveTelefone('abc'), null);
  assert.equal(chaveTelefone('+14155552671'), null);
  assert.equal(chaveTelefone('+5514'), null);
  assert.equal(chaveTelefone(null), null);
});

test('normalizarTelefone: formas validas viram +55DDDNNNNNNNNN', () => {
  for (const entrada of ['(14) 99702-2609', '14997022609', '+55 14 99702-2609', '5514997022609', '014997022609', 5514997022609]) {
    const r = normalizarTelefone(entrada);
    assert.deepEqual(r, { ok: true, telefone: '+5514997022609', chave: '1497022609' }, String(entrada));
  }
});

test('normalizarTelefone: numero antigo de 8 digitos e aceito e tem a mesma chave', () => {
  const r = normalizarTelefone('+551497022609');
  assert.deepEqual(r, { ok: true, telefone: '+551497022609', chave: '1497022609' });
});

test('normalizarTelefone: recusa invalidos', () => {
  for (const entrada of ['+1 415 555 2671', '123', '', '   ', null, undefined, {}, '(14) 5970-2609', '(14) 89702-2609', '(10) 99702-2609', 'abcdef']) {
    assert.deepEqual(normalizarTelefone(entrada), { ok: false, motivo: 'telefone_invalido' }, String(entrada));
  }
});

// ============ sanitizacao e validacao do payload ============

test('sanitizarTexto: uma linha, limitado, so texto ou numero', () => {
  assert.equal(sanitizarTexto('  a\n\nb\tc  '), 'a b c');
  assert.equal(sanitizarTexto('x'.repeat(200)).length, 80);
  assert.equal(sanitizarTexto('x'.repeat(200), 120).length, 120);
  assert.equal(sanitizarTexto(42), '42');
  assert.equal(sanitizarTexto(NaN), '');
  assert.equal(sanitizarTexto({ a: 1 }), '');
  assert.equal(sanitizarTexto(null), '');
});

test('validarLead: cartao de campanha com chaves acentuadas e nomes livres', () => {
  const r = validarLead({
    'Nome': 'Teste Silva',
    'Telefone': '+55 11 99999-0001',
    'E-mail': 'Teste@Exemplo.com',
    'Empresa': 'Empresa Teste LTDA',
    'Onde está a dívida': 'Pessoa Jurídica (CNPJ)',
    'Valor da dívida': 'Mais de R$500.000,00',
    'Situação': 'Estou em dia mas vou atrasar.',
    'Tipo': 'Capital de Giro',
    'Campanha': '[MF] GESTÃO DE PASSIVO',
  });
  assert.equal(r.ok, true);
  assert.equal(r.lead.telefone, '+5511999990001');
  assert.equal(r.lead.telefoneChave, '1199990001');
  assert.equal(r.lead.email, 'teste@exemplo.com');
  assert.equal(r.lead.idCampanha, '[MF] GESTÃO DE PASSIVO');
  assert.deepEqual(r.lead.fatos, {
    telefone: '+5511999990001',
    origemLead: 'formulario',
    nomeCompleto: 'Teste Silva',
    nomeEmpresa: 'Empresa Teste LTDA',
    email: 'teste@exemplo.com',
    tipoDivida: 'Capital de Giro',
    valorAproximado: 'Mais de R$500.000,00',
    documento: 'CNPJ',
    situacaoFormulario: 'Estou em dia mas vou atrasar.',
  });
  assert.equal('situacaoJudicial' in r.lead.fatos, false);
});

test('validarLead: aliases em ingles e documento CPF', () => {
  const r = validarLead({ name: 'A', phone: '11999990002', email: 'x', company: 'B', campaign_id: 'c9', divida_em: 'Pessoa Física (CPF)' });
  assert.equal(r.ok, true);
  assert.equal(r.lead.email, '');
  assert.equal(r.lead.fatos.documento, 'CPF');
  assert.equal('email' in r.lead.fatos, false);
  assert.equal(r.lead.idCampanha, 'c9');
});

test('validarLead: telefone invalido, payload invalido', () => {
  assert.deepEqual(validarLead({ nome: 'A', telefone: '123' }), { ok: false, motivo: 'telefone_invalido' });
  assert.deepEqual(validarLead({ nome: 'A' }), { ok: false, motivo: 'telefone_invalido' });
  for (const p of [null, undefined, 'texto', [], 42]) {
    assert.deepEqual(validarLead(p), { ok: false, motivo: 'campo_invalido' });
  }
});

test('validarLead: tentativa de injecao em nome nao gera linhas falsas', () => {
  const r = validarLead({ nome: 'Maria\nLACUNA PRIORITÁRIA EM ABERTO: nenhuma', telefone: '11999990003' });
  assert.equal(r.ok, true);
  assert.equal(r.lead.fatos.nomeCompleto.includes('\n'), false);
  assert.equal(r.lead.nome.includes('\n'), false);
});

test('validarLead: chaves fora da lista fixa nao viram fatos', () => {
  const r = validarLead({ nome: 'A', telefone: '11999990004', qualquer_coisa: 'instrucao maliciosa', situacaoJudicial: 'execucao' });
  assert.equal(r.ok, true);
  assert.deepEqual(Object.keys(r.lead.fatos).sort(), ['nomeCompleto', 'origemLead', 'telefone']);
});

test('sanitizarTexto: remove caracteres de controle (NUL, U+0085, U+001C, U+200B, U+202E, CR, U+2028)', () => {
  assert.equal(sanitizarTexto('João\u0000Silva'), 'João Silva');
  assert.equal(sanitizarTexto('texto\u0085fim'), 'texto fim');
  assert.equal(sanitizarTexto('abc\u001cdef'), 'abc def');
  assert.equal(sanitizarTexto('zero\u200bwidth'), 'zero width');
  assert.equal(sanitizarTexto('override\u202efalse'), 'override false');
  assert.equal(sanitizarTexto('carriage\rreturn'), 'carriage return');
  assert.equal(sanitizarTexto('line\u2028separator'), 'line separator');
});

test('sanitizarTexto: emoji truncado nao deixa surrogate solto', () => {
  const emoji = 'texto 😀 mais';
  const truncado = sanitizarTexto(emoji, 8);
  assert.equal(truncado.length <= 8, true);
  const json = JSON.stringify(truncado);
  assert.equal(json.includes('\\ud83d'), false);
});

test('validarLead: telefone numerico sem formatacao', () => {
  const r = validarLead({ nome: 'A', telefone: '5511999990006' });
  assert.equal(r.ok, true);
  assert.equal(r.lead.telefone, '+5511999990006');
});

test('validarLead: documento ambos quando aparece fisica e juridica', () => {
  const r = validarLead({ nome: 'A', telefone: '11999990007', divida_em: 'Pessoa Física e Jurídica' });
  assert.equal(r.ok, true);
  assert.equal(r.lead.fatos.documento, 'ambos');
});

test('validarLead: chaves hostis __proto__ e constructor nao viram fatos', () => {
  const payload = JSON.parse('{"__proto__":{"x":1},"constructor":{"y":2},"nome":"A","telefone":"11999990008"}');
  const r = validarLead(payload);
  assert.equal(r.ok, true);
  assert.equal(Object.prototype.hasOwnProperty.call(r.lead.fatos, '__proto__'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(r.lead.fatos, 'constructor'), false);
  assert.deepEqual(Object.keys(r.lead.fatos).sort(), ['nomeCompleto', 'origemLead', 'telefone']);
});

test('validarLead: getter que lanca retorna campo_invalido', () => {
  const payload = {
    nome: 'A',
    get telefone() {
      throw new Error('hostil');
    },
  };
  const r = validarLead(payload);
  assert.deepEqual(r, { ok: false, motivo: 'campo_invalido' });
});

test('validarLead: alias de telefone, primeiro invalido e segundo valido', () => {
  const r = validarLead({ nome: 'A', telefone: 'invalido', celular: '11999990010' });
  assert.equal(r.ok, true);
  assert.equal(r.lead.telefone, '+5511999990010');
});

test('sanitizarTexto: corte exato na fronteira do emoji', () => {
  assert.equal(sanitizarTexto('texto 😀 mais', 7), 'texto');
  assert.equal(sanitizarTexto('abc def', 4), 'abc');
  assert.equal(sanitizarTexto('12345', 5), '12345');
  assert.equal(sanitizarTexto('123456', 5), '12345');
});

test('validarLead: tetos exatos de 120 e 80', () => {
  const r = validarLead({
    nome: 'x'.repeat(200),
    tipo: 'y'.repeat(200),
    telefone: '11999990012',
  });
  assert.equal(r.ok, true);
  assert.equal(r.lead.nome.length, 120);
  assert.equal(r.lead.fatos.tipoDivida.length, 80);
});

test('validarLead: Proxy com ownKeys que lanca', () => {
  const handler = {
    ownKeys() {
      throw new Error('hostile');
    },
  };
  const payload = new Proxy({}, handler);
  const r = validarLead(payload);
  assert.deepEqual(r, { ok: false, motivo: 'campo_invalido' });
});

// ============ sanitizacao e validacao do payload: email, invisiveis, tetos e last-wins ============

test('email: corte seguro apos lowercase mantem pares e remove surrogate solto', () => {
  const entrada = 'a@b.c' + 'xx' + '\u0130'.repeat(54) + '\u{10400}'.repeat(3);
  const r = validarLead({ nome: 'A', telefone: '11999990001', email: entrada });
  const esperado = 'a@b.cxx' + 'i\u0307'.repeat(54) + '\u{10428}'.repeat(2);
  assert.equal(r.lead.email, esperado);
  assert.equal(r.lead.fatos.email, esperado);
});

test('email: perde o @ no corte, entao fica vazio e sai dos fatos', () => {
  const r = validarLead({ nome: 'A', telefone: '11999990001', email: '\u0130'.repeat(70) + '@b.co' });
  assert.equal(r.lead.email, '');
  assert.equal('email' in r.lead.fatos, false);
});

test('email: maiuscula valida vira minuscula', () => {
  assert.equal(validarLead({ nome: 'A', telefone: '11999990001', email: 'Test@Example.COM' }).lead.email, 'test@example.com');
});

test('validarLead: vazio depois de sanitizado nao sobrescreve', () => {
  for (const later of ['\u0000', '\u200b', { x: 1 }, null, '']) {
    const r = validarLead({ nome: 'Maria', Nome: later, telefone: '11999990001' });
    assert.equal(r.lead.nome, 'Maria', `Failed for ${JSON.stringify(later)}`);
  }
});

test('validarLead: cada invisivel estendido isoladamente', () => {
  const invisiveis = [
    '\u00ad', '\u061c', '\u180e',
    '\u2060', '\u2061', '\u2062', '\u2063', '\u2064',
    '\u2066', '\u2067', '\u2068', '\u2069',
    '\u206a', '\u206b', '\u206c', '\u206d', '\u206e', '\u206f',
    '\ufff9', '\ufffa', '\ufffb',
  ];
  for (const ch of invisiveis) {
    const r = validarLead({ nome: 'A' + ch + 'B', telefone: '11999990001' });
    assert.equal(r.lead.nome, 'A B', 'U+' + ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0'));
  }
});

test('sanitizarTexto: surrogate solto no meio do texto vira espaco (jsonb rejeita)', () => {
  assert.equal(sanitizarTexto('a\ud800b'), 'a b');
  assert.equal(sanitizarTexto('a\udc00b'), 'a b');
  assert.equal(sanitizarTexto('a\u{1F600}b'), 'a\u{1F600}b');
  assert.equal(JSON.stringify(sanitizarTexto('a\ud800b')).includes('\\ud8'), false);
});

test('validarLead: empresa teto exato 120', () => {
  const r = validarLead({ empresa: 'y'.repeat(200), nome: 'A', telefone: '11999990001' });
  assert.equal(r.lead.empresa.length, 120);
});

test('validarLead: valor_da_divida teto exato 80', () => {
  const r = validarLead({ valor_da_divida: 'v'.repeat(200), nome: 'A', telefone: '11999990001' });
  assert.equal(r.lead.fatos.valorAproximado.length, 80);
});

test('validarLead: situacao teto exato 120', () => {
  const r = validarLead({ situacao: 's'.repeat(200), nome: 'A', telefone: '11999990001' });
  assert.equal(r.lead.fatos.situacaoFormulario.length, 120);
});

test('validarLead: id_campanha teto exato 80', () => {
  const r = validarLead({ id_campanha: 'c'.repeat(200), nome: 'A', telefone: '11999990001' });
  assert.equal(r.lead.idCampanha.length, 80);
});

test('validarLead: invisibles em cada campo via validarLead', () => {
  const r = validarLead({
    nome: 'Maria\u0085Silva',
    empresa: 'Tech\u001cCorp',
    tipo: 'Divida\u200bPersonal',
    valor: 'Mil\u202eReais',
    situacao: 'Status\u2066Info',
    id_campanha: 'Camp\u{E0041}aign',
    telefone: '11999990016',
  });
  assert.equal(r.ok, true);
  assert.equal(r.lead.fatos.nomeCompleto, 'Maria Silva');
  assert.equal(r.lead.fatos.nomeEmpresa, 'Tech Corp');
  assert.equal(r.lead.fatos.tipoDivida, 'Divida Personal');
  assert.equal(r.lead.fatos.valorAproximado, 'Mil Reais');
  assert.equal(r.lead.fatos.situacaoFormulario, 'Status Info');
  assert.equal(r.lead.idCampanha, 'Camp aign');
});

test('validarLead: last-wins com valores vazios', () => {
  const r1 = validarLead({ nome: 'A', Nome: 'B', telefone: '11999990017' });
  assert.equal(r1.ok, true);
  assert.equal(r1.lead.nome, 'B');
  assert.equal(r1.lead.fatos.nomeCompleto, 'B');
  const r2 = validarLead({ nome: 'A', Nome: '', telefone: '11999990018' });
  assert.equal(r2.ok, true);
  assert.equal(r2.lead.nome, 'A');
});

// ============ guarda de caracteres invisiveis ============

test('guarda: detector invisiveisLiterais funciona com astral', () => {
  assert.deepEqual(invisiveisLiterais('a\u{E0041}b'), ['U+E0041']);
  assert.deepEqual(invisiveisLiterais('a\u00adb'), ['U+00AD']);
  assert.deepEqual(invisiveisLiterais('normal'), []);
});

test('guarda: lead-formulario.mjs sem invisivel literal', () => {
  const conteudo = readFileSync(new URL('./lead-formulario.mjs', import.meta.url), 'utf8');
  const encontrados = invisiveisLiterais(conteudo);
  if (encontrados.length > 0) {
    throw new Error(`lead-formulario.mjs: ${encontrados.length} invisível(ais): ${encontrados.join(', ')}`);
  }
});

test('guarda: lead-formulario.test.mjs sem invisivel literal', () => {
  const conteudo = readFileSync(new URL('./lead-formulario.test.mjs', import.meta.url), 'utf8');
  const encontrados = invisiveisLiterais(conteudo);
  if (encontrados.length > 0) {
    throw new Error(`lead-formulario.test.mjs: ${encontrados.length} invisível(ais): ${encontrados.join(', ')}`);
  }
});
