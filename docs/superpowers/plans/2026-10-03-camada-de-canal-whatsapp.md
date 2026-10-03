# Camada de Canal do WhatsApp (Fase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Desacoplar o WhatsApp da Mayara usando só a API oficial da Meta: um único workflow de envio (`Canal: Enviar`) usado pelos 8 pontos que hoje chamam a Graph API, e um sub-workflow de processamento (`Canal: Processar Evento`) que o Gateway chama depois de normalizar. Comportamento visível idêntico ao de hoje.

**Architecture:** Três tabelas e três funções SQL no Supabase concentram a escolha de provedor, a política de envio e a auditoria. Uma biblioteca JS testada monta os corpos das requisições. `Canal: Enviar` devolve **exatamente o formato de resposta da Graph API** (`messages[0].id` em sucesso, `error` em falha), então o `Envio OK?` da Ponte continua funcionando sem mudança. O provedor `evolution` fica pronto na biblioteca e no SQL, mas **não é ligado** nesta fase.

**Tech Stack:** Postgres (Supabase `wuhvlvsolewslkawazlq`), n8n, Node.js (`node:test`), Graph API v25.0.

**Spec:** `docs/superpowers/specs/2026-10-03-camada-de-canal-whatsapp-design.md`

**Fora deste plano (plano próprio depois):** Fase 2 (Evolution no Coolify, `Canal: Receber Evolution`, `Canal: Estado`, credencial de e-mail). Ela depende de a Evolution estar no ar e de payloads reais de teste.

## Global Constraints

- Mesmas regras de segurança da Central: tabelas com RLS ligada e sem policies, `revoke all ... from anon, authenticated`; funções com `search_path = ''` e `revoke` do público.
- Telefone sempre normalizado para só dígitos (`5514997022609`) no pedido de envio; comparações por `mayara.chave_telefone`.
- Prefixo de identificação: `*Mayara:*` + quebra de linha, **uma única vez** (idempotente), só quando `identificarMayara = 'true'`.
- Credenciais do n8n reutilizadas: Postgres `nNpCUIhnDuVvTApU`, WhatsApp `SChAKcHay4ghJVwe`. Linha Meta atual: `phone_number_id` `1365007506685934`. Workflow de erro: `CQyjBKLX0UheNh1q`.
- Regras da ferramenta de edição do n8n: (a) "Connection closed" não prova falha, **sempre reler antes de repetir**; (b) trechos novos grandes derrubam a chamada: dividir em patches de até ~300 caracteres; (c) não editar nós Postgres de operação `upsert`; (d) se `addNode` de `IF`/`executeWorkflow`/Postgres falhar com "reading 'map'", adicionar um `noOp` ligado ao ponto certo e converter com `updateNode` (`type`, `typeVersion`, `parameters`); a saída de erro (`sourceIndex 1`) só se liga depois que o nó existe com `onError: continueErrorOutput`; (e) sub-workflow chamado precisa estar **publicado** antes de ser referenciado; (f) rollback: `n8n_workflow_versions`.
- Nenhuma escrita em produção (migration, SQL de dados, ativação de workflow) sem autorização do usuário na hora.
- Trocar **um** ponto de envio por vez e conferir antes de seguir.

## Review Focus

1. A Ponte continua decidindo `Envio OK?` corretamente, em sucesso e em falha, porque `Canal: Enviar` devolve o formato da Graph API. Testado em JS (Task 2) e ao vivo (Task 4).
2. Telefones em formatos diferentes (`+55 14 99702-2609`, `5514997022609`) chegam como dígitos ao provedor. Testado em JS.
3. O prefixo `*Mayara:*` nunca é duplicado (texto que já começa com ele, ou reenvio). Testado em JS.
4. Canal desconhecido ou inativo: não envia, grava o motivo, devolve `ok: false`. Testado em SQL e ao vivo.
5. Template sem variáveis (o do formulário) não leva `components` vazios, e o do lembrete leva as variáveis em ordem. Testado em JS.

## File Structure

| Arquivo | Responsabilidade |
|---|---|
| `supabase/migrations/0012_mayara_canais.sql` | Tabelas `canais`, `envios_log`, `canal_templates`; funções `pode_enviar` e `registrar_envio`. |
| `supabase/tests/0012_canais.test.sql` | Testes SQL em transação desfeita. |
| `docs/superpowers/specs/2026-10-03-camada-canal/canal.mjs` | Biblioteca: validação, prefixo, corpos Meta e Evolution, interpretação da resposta. |
| `.../canal.test.mjs` | Testes da biblioteca. |
| `.../gerar-enviar.mjs` e `.../gerar-enviar.test.mjs` | Geram e testam o workflow `Canal: Enviar`. |
| `.../gerar-processar.mjs` e `.../gerar-processar.test.mjs` | Geram e testam o workflow `Canal: Processar Evento`. |
| `docs/superpowers/specs/workflows/mayara-canal-enviar.json`, `mayara-canal-processar-evento.json` | Exports versionados. |

---

### Task 1: Migration 0012 (canais, log de envios e política de envio)

**Files:**
- Create: `supabase/migrations/0012_mayara_canais.sql`
- Create: `supabase/tests/0012_canais.test.sql`

**Interfaces:**
- Produces (schema `mayara`): tabelas `canais(canal_id, provedor, rotulo, telefone, ativo, criado_em)`, `envios_log`, `canal_templates(nome, corpo)`; `pode_enviar(p_canal_id text, p_destino text, p_tipo text) returns jsonb` (`{ok:true, provedor}` ou `{ok:false, motivo}` com motivo em `canal_desconhecido`, `canal_inativo`, `destino_invalido`, `fora_da_janela`, `teto_por_minuto`); `registrar_envio(p_canal_id text, p_destino text, p_tipo text, p_resultado jsonb) returns jsonb` (grava e **devolve `p_resultado`**).
- Consumes: `mayara.chave_telefone`, `mayara.config`, `mayara.session_state.last_lead_message_at`, `mayara.comandos_log` (migration 0011).

- [ ] **Step 1: Escrever o teste SQL**

Criar `supabase/tests/0012_canais.test.sql`:

```sql
-- supabase/tests/0012_canais.test.sql
-- Rodar inteiro (execute_sql). Numeros ficticios; termina em rollback.
begin;

insert into mayara.canais (canal_id, provedor, rotulo) values
  ('t-meta', 'meta', 'Teste Meta'),
  ('t-evo', 'evolution', 'Teste Evolution'),
  ('t-off', 'meta', 'Teste Inativo');
update mayara.canais set ativo = false where canal_id = 't-off';

do $t$
declare r jsonb; i int;
begin
  -- canal desconhecido / inativo / meta
  r := mayara.pode_enviar('nao-existe', '5511999990201', 'texto');
  assert (r ->> 'ok') = 'false' and (r ->> 'motivo') = 'canal_desconhecido', 'desconhecido: ' || r::text;
  r := mayara.pode_enviar('t-off', '5511999990201', 'texto');
  assert (r ->> 'motivo') = 'canal_inativo', 'inativo: ' || r::text;
  r := mayara.pode_enviar('t-meta', '5511999990201', 'texto');
  assert (r ->> 'ok') = 'true' and (r ->> 'provedor') = 'meta', 'meta libera: ' || r::text;
  r := mayara.pode_enviar('1365007506685934', '5514997022609', 'texto');
  assert (r ->> 'ok') = 'true', 'linha Meta real cadastrada na migration: ' || r::text;

  -- evolution: destino invalido, fora da janela, dentro da janela (sessao), dentro da janela (comando)
  r := mayara.pode_enviar('t-evo', '123', 'texto');
  assert (r ->> 'motivo') = 'destino_invalido', 'destino invalido: ' || r::text;
  r := mayara.pode_enviar('t-evo', '5511999990201', 'texto');
  assert (r ->> 'motivo') = 'fora_da_janela', 'sem mensagem recebida: ' || r::text;

  insert into mayara.session_state (session_key, phone, estado, last_lead_message_at)
    values ('whatsapp:t-evo:+5511999990201', '+5511999990201', 'S1_ENGAJADO', now() - interval '1 hour');
  r := mayara.pode_enviar('t-evo', '5511999990201', 'texto');
  assert (r ->> 'ok') = 'true' and (r ->> 'provedor') = 'evolution', 'dentro da janela: ' || r::text;
  update mayara.session_state set last_lead_message_at = now() - interval '49 hours' where session_key = 'whatsapp:t-evo:+5511999990201';
  r := mayara.pode_enviar('t-evo', '5511999990201', 'texto');
  assert (r ->> 'motivo') = 'fora_da_janela', 'janela de 48h vencida: ' || r::text;

  insert into mayara.comandos_log (message_id, admin_chave, entrada, criado_em)
    values ('wamid.canal1', mayara.chave_telefone('+5511999990202'), '/status', now() - interval '10 minutes');
  r := mayara.pode_enviar('t-evo', '5511999990202', 'texto');
  assert (r ->> 'ok') = 'true', 'administrador que escreveu ha pouco tambem libera: ' || r::text;

  -- teto por minuto
  update mayara.config set valor = '3' where chave = 'evolution_teto_por_minuto';
  update mayara.session_state set last_lead_message_at = now() where session_key = 'whatsapp:t-evo:+5511999990201';
  for i in 1..3 loop
    perform mayara.registrar_envio('t-evo', '5511999990201', 'texto', '{"ok":true,"messages":[{"id":"x"}]}'::jsonb);
  end loop;
  r := mayara.pode_enviar('t-evo', '5511999990201', 'texto');
  assert (r ->> 'motivo') = 'teto_por_minuto', 'teto: ' || r::text;
  update mayara.config set valor = '20' where chave = 'evolution_teto_por_minuto';

  -- registrar_envio devolve o resultado e grava os campos certos
  r := mayara.registrar_envio('t-meta', '5511999990203', 'texto', '{"ok":true,"messages":[{"id":"wamid.AAA"}]}'::jsonb);
  assert (r ->> 'ok') = 'true', 'devolve o resultado de sucesso';
  assert (select provedor_message_id from mayara.envios_log where destino_chave = mayara.chave_telefone('5511999990203')) = 'wamid.AAA', 'grava o id do provedor';
  r := mayara.registrar_envio('t-meta', '5511999990204', 'template', '{"ok":false,"error":{"message":"falhou"}}'::jsonb);
  assert (r #>> '{error,message}') = 'falhou', 'devolve o resultado de falha';
  assert (select erro from mayara.envios_log where destino_chave = mayara.chave_telefone('5511999990204')) = 'falhou', 'grava o erro';
  assert (select ok from mayara.envios_log where destino_chave = mayara.chave_telefone('5511999990204')) = false, 'grava ok=false';
end $t$;

rollback;
select 'OK 0012' as resultado;
```

- [ ] **Step 2: Rodar e ver falhar**

Rodar o arquivo inteiro com `execute_sql`. Expected: `relation "mayara.canais" does not exist`.

- [ ] **Step 3: Escrever a migration**

Criar `supabase/migrations/0012_mayara_canais.sql`:

```sql
-- supabase/migrations/0012_mayara_canais.sql
-- Camada de canal do WhatsApp: linhas, log de envios, textos de template e politica de envio.

create table mayara.canais (
  canal_id text primary key,
  provedor text not null check (provedor in ('meta', 'evolution')),
  rotulo text not null,
  telefone text,
  ativo boolean not null default true,
  criado_em timestamptz not null default now()
);

create table mayara.envios_log (
  id bigserial primary key,
  canal_id text not null,
  destino_chave text not null,
  tipo text not null check (tipo in ('texto', 'template')),
  ok boolean not null,
  erro text,
  provedor_message_id text,
  criado_em timestamptz not null default now()
);
create index envios_log_canal_tempo_idx on mayara.envios_log (canal_id, criado_em desc);

create table mayara.canal_templates (
  nome text primary key,
  corpo text not null
);

alter table mayara.canais enable row level security;
alter table mayara.envios_log enable row level security;
alter table mayara.canal_templates enable row level security;
revoke all on mayara.canais, mayara.envios_log, mayara.canal_templates from anon, authenticated;
revoke all on sequence mayara.envios_log_id_seq from anon, authenticated;

insert into mayara.config (chave, valor) values
  ('evolution_janela_horas', '48'),
  ('evolution_teto_por_minuto', '20')
on conflict (chave) do nothing;

insert into mayara.canais (canal_id, provedor, rotulo, telefone) values
  ('1365007506685934', 'meta', 'Linha Meta (numero de teste)', '+15556566060')
on conflict (canal_id) do nothing;

create or replace function mayara.pode_enviar(p_canal_id text, p_destino text, p_tipo text)
returns jsonb language plpgsql stable set search_path = '' as $$
declare
  v mayara.canais%rowtype;
  v_chave text := mayara.chave_telefone(p_destino);
  v_janela int := coalesce((select valor::int from mayara.config where chave = 'evolution_janela_horas'), 48);
  v_teto int := coalesce((select valor::int from mayara.config where chave = 'evolution_teto_por_minuto'), 20);
begin
  select * into v from mayara.canais where canal_id = p_canal_id;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'canal_desconhecido');
  end if;
  if not v.ativo then
    return jsonb_build_object('ok', false, 'motivo', 'canal_inativo');
  end if;
  if v.provedor = 'meta' then
    return jsonb_build_object('ok', true, 'provedor', 'meta');
  end if;
  if v_chave is null then
    return jsonb_build_object('ok', false, 'motivo', 'destino_invalido');
  end if;
  if not (
    exists (select 1 from mayara.session_state s
            where mayara.chave_telefone(s.phone) = v_chave
              and s.last_lead_message_at > now() - make_interval(hours => v_janela))
    or exists (select 1 from mayara.comandos_log c
               where c.admin_chave = v_chave
                 and c.criado_em > now() - make_interval(hours => v_janela))
  ) then
    return jsonb_build_object('ok', false, 'motivo', 'fora_da_janela');
  end if;
  if (select count(*) from mayara.envios_log l
       where l.canal_id = p_canal_id and l.criado_em > now() - interval '1 minute') >= v_teto then
    return jsonb_build_object('ok', false, 'motivo', 'teto_por_minuto');
  end if;
  return jsonb_build_object('ok', true, 'provedor', 'evolution');
end $$;

create or replace function mayara.registrar_envio(p_canal_id text, p_destino text, p_tipo text, p_resultado jsonb)
returns jsonb language plpgsql set search_path = '' as $$
begin
  insert into mayara.envios_log (canal_id, destino_chave, tipo, ok, erro, provedor_message_id)
  values (
    p_canal_id,
    coalesce(mayara.chave_telefone(p_destino), regexp_replace(coalesce(p_destino, ''), '[^0-9]', '', 'g')),
    p_tipo,
    coalesce((p_resultado ->> 'ok')::boolean, false),
    p_resultado #>> '{error,message}',
    p_resultado #>> '{messages,0,id}'
  );
  return p_resultado;
end $$;

revoke all on function mayara.pode_enviar(text, text, text) from public, anon, authenticated;
revoke all on function mayara.registrar_envio(text, text, text, jsonb) from public, anon, authenticated;
```

- [ ] **Step 4: Pedir autorização e aplicar**

Pedir ao usuário autorização para aplicar a migration `0012` em produção (3 tabelas novas, 2 funções, 2 chaves de configuração e 1 linha em `canais`; nada existente é alterado). Aplicar com `apply_migration` (nome `mayara_canais`). Sem autorização, parar o plano aqui.

- [ ] **Step 5: Rodar o teste e ver passar**

Rodar `supabase/tests/0012_canais.test.sql` inteiro. Expected: `OK 0012`. Conferir depois (consulta separada) que `mayara.canais` tem só a linha `1365007506685934` e `envios_log` está vazia.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/0012_mayara_canais.sql supabase/tests/0012_canais.test.sql
git commit -m "feat(canal): tabelas e politica de envio da camada de canal

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Biblioteca do canal (JavaScript) e testes

**Files:**
- Create: `docs/superpowers/specs/2026-10-03-camada-canal/canal.mjs`
- Test: `docs/superpowers/specs/2026-10-03-camada-canal/canal.test.mjs`

**Interfaces:**
- Produces (exports): `PREFIXO` (`'*Mayara:*\n'`), `soDigitos(t)`, `aplicarPrefixo(texto)`, `validarPedido(entrada) -> { ok:true, pedido } | { ok:false, erro }`, `montarCorpoMeta(pedido) -> objeto`, `renderTemplate(corpo, variaveis) -> string`, `montarEvolution(pedido, corpoTemplate?) -> { caminho, corpo }`, `atrasoHumanoMs(texto) -> number`, `interpretarRespostaMeta(resposta) -> objeto`.
- `pedido` normalizado: `{ canalId, para (so digitos), tipo, texto, templateNome, templateVariaveis (array), identificar (boolean), origem }`.
- Portabilidade: sem `import`, sem dependências e **sem caracteres Unicode invisíveis ou combinantes literais** (o corpo vai para Code nodes do n8n).

- [ ] **Step 1: Escrever os testes (falham: módulo não existe)**

Criar `canal.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  PREFIXO, soDigitos, aplicarPrefixo, validarPedido, montarCorpoMeta,
  renderTemplate, montarEvolution, atrasoHumanoMs, interpretarRespostaMeta,
} from './canal.mjs';

test('soDigitos e telefones em formatos diferentes', () => {
  for (const t of ['+55 14 99702-2609', '5514997022609', '(55) 14 99702.2609']) {
    assert.equal(soDigitos(t), '5514997022609', t);
  }
});

test('aplicarPrefixo nunca duplica', () => {
  assert.equal(aplicarPrefixo('Oi'), PREFIXO + 'Oi');
  assert.equal(aplicarPrefixo(PREFIXO + 'Oi'), PREFIXO + 'Oi');
  assert.equal(aplicarPrefixo(aplicarPrefixo('Oi')), PREFIXO + 'Oi');
  assert.equal(aplicarPrefixo(null), PREFIXO);
});

test('validarPedido aceita texto e normaliza', () => {
  const v = validarPedido({ canalId: '123', para: '+55 14 99702-2609', tipo: 'texto', texto: ' Oi ', identificarMayara: 'true', origem: 'ponte' });
  assert.equal(v.ok, true);
  assert.deepEqual(v.pedido, { canalId: '123', para: '5514997022609', tipo: 'texto', texto: 'Oi', templateNome: '', templateVariaveis: [], identificar: true, origem: 'ponte' });
});

test('validarPedido recusa o que esta errado', () => {
  const base = { canalId: '123', para: '5514997022609', tipo: 'texto', texto: 'Oi' };
  for (const [muda, esperado] of [
    [{ canalId: '' }, 'canalId'], [{ para: '123' }, 'para'], [{ tipo: 'audio' }, 'tipo'],
    [{ texto: '   ' }, 'texto'], [{ texto: 'x'.repeat(4097) }, 'texto'],
    [{ tipo: 'template', texto: '', templateNome: '' }, 'templateNome'],
    [{ tipo: 'template', templateNome: 'a', templateVariaveis: '{nao-json' }, 'templateVariaveis'],
  ]) {
    const v = validarPedido({ ...base, ...muda });
    assert.equal(v.ok, false, JSON.stringify(muda));
    assert.match(v.erro, new RegExp(esperado), JSON.stringify(muda));
  }
});

test('montarCorpoMeta: texto, com e sem prefixo', () => {
  const p = validarPedido({ canalId: '1', para: '5514997022609', tipo: 'texto', texto: 'Oi', identificarMayara: true }).pedido;
  assert.deepEqual(montarCorpoMeta(p), { messaging_product: 'whatsapp', to: '5514997022609', type: 'text', text: { body: PREFIXO + 'Oi' } });
  const q = validarPedido({ canalId: '1', para: '5514997022609', tipo: 'texto', texto: 'Oi' }).pedido;
  assert.equal(montarCorpoMeta(q).text.body, 'Oi');
});

test('montarCorpoMeta: template com variaveis em ordem e sem variaveis', () => {
  const com = validarPedido({ canalId: '1', para: '5514997022609', tipo: 'template', templateNome: 'lembrete', templateVariaveis: JSON.stringify(['Joao', 5, 'amanha']) }).pedido;
  assert.deepEqual(montarCorpoMeta(com), {
    messaging_product: 'whatsapp', to: '5514997022609', type: 'template',
    template: { name: 'lembrete', language: { code: 'pt_BR' },
      components: [{ type: 'body', parameters: [{ type: 'text', text: 'Joao' }, { type: 'text', text: '5' }, { type: 'text', text: 'amanha' }] }] },
  });
  const sem = validarPedido({ canalId: '1', para: '5514997022609', tipo: 'template', templateNome: 'primeiro_contato_campanha', templateVariaveis: '[]' }).pedido;
  assert.equal('components' in montarCorpoMeta(sem).template, false);
});

test('renderTemplate e montarEvolution', () => {
  assert.equal(renderTemplate('Ola {{1}}, sua consulta e {{2}}.', ['Ana', 'amanha']), 'Ola Ana, sua consulta e amanha.');
  assert.equal(renderTemplate('Sem variavel {{3}}', ['a']), 'Sem variavel ');
  const p = validarPedido({ canalId: 'inst1', para: '5514997022609', tipo: 'texto', texto: 'Oi', identificarMayara: true }).pedido;
  assert.deepEqual(montarEvolution(p), { caminho: '/message/sendText/inst1', corpo: { number: '5514997022609', text: PREFIXO + 'Oi' } });
  const t = validarPedido({ canalId: 'inst1', para: '5514997022609', tipo: 'template', templateNome: 'lembrete', templateVariaveis: '["Ana"]' }).pedido;
  assert.equal(montarEvolution(t, 'Ola {{1}}').corpo.text, 'Ola Ana');
  assert.throws(() => montarEvolution(t), /template/);
});

test('atrasoHumanoMs fica entre 1000 e 4000', () => {
  assert.equal(atrasoHumanoMs(''), 1000);
  assert.ok(atrasoHumanoMs('x'.repeat(100)) > 1000);
  assert.equal(atrasoHumanoMs('x'.repeat(5000)), 4000);
});

test('interpretarRespostaMeta mantem o formato da Graph API (a Ponte depende disso)', () => {
  const ok = interpretarRespostaMeta({ messaging_product: 'whatsapp', contacts: [{ wa_id: '55' }], messages: [{ id: 'wamid.X' }] });
  assert.equal(ok.ok, true);
  assert.equal(ok.messages[0].id, 'wamid.X');
  assert.ok(!ok.error);
  for (const ruim of [{ error: 'timeout' }, { error: { message: 'Invalid token' } }, {}, { messages: [] }, null]) {
    const r = interpretarRespostaMeta(ruim);
    assert.equal(r.ok, false, JSON.stringify(ruim));
    assert.ok(r.error && r.error.message, JSON.stringify(ruim));
    assert.ok(!Array.isArray(r.messages), JSON.stringify(ruim));
  }
  assert.equal(interpretarRespostaMeta({ error: { message: 'Invalid token' } }).error.message, 'Invalid token');
});

test('o codigo-fonte nao tem caracteres invisiveis ou combinantes literais', () => {
  const fonte = readFileSync(new URL('./canal.mjs', import.meta.url), 'utf8');
  const proibido = (c) => (c >= 0x300 && c <= 0x36f) || (c >= 0x200b && c <= 0x200f) || c === 0x2028 || c === 0x2029 || c === 0xfeff;
  const achados = [];
  for (let i = 0; i < fonte.length; i++) if (proibido(fonte.charCodeAt(i))) achados.push(i);
  assert.deepEqual(achados, []);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd docs/superpowers/specs/2026-10-03-camada-canal && node --test canal.test.mjs`
Expected: FAIL com `Cannot find module './canal.mjs'`.

- [ ] **Step 3: Implementar a biblioteca**

Criar `canal.mjs`:

```js
// canal.mjs
// Biblioteca da camada de canal. Sem import e sem dependencias: o corpo e copiado
// para Code nodes do n8n (gerar-enviar.mjs remove o "export ").

export const PREFIXO = '*Mayara:*\n';

export function soDigitos(t) {
  return String(t ?? '').replace(/\D/g, '');
}

export function aplicarPrefixo(texto) {
  const t = String(texto ?? '');
  return t.startsWith(PREFIXO) ? t : PREFIXO + t;
}

function lerVariaveis(v) {
  if (Array.isArray(v)) return v;
  if (v === undefined || v === null || String(v).trim() === '') return [];
  try {
    const o = JSON.parse(String(v));
    return Array.isArray(o) ? o : null;
  } catch (e) {
    return null;
  }
}

export function validarPedido(entrada) {
  const e = entrada || {};
  const canalId = String(e.canalId ?? '').trim();
  if (!canalId) return { ok: false, erro: 'canalId ausente' };
  const para = soDigitos(e.para);
  if (para.length < 10 || para.length > 15) return { ok: false, erro: 'para invalido' };
  const tipo = String(e.tipo ?? '');
  if (tipo !== 'texto' && tipo !== 'template') return { ok: false, erro: 'tipo invalido' };
  const texto = String(e.texto ?? '').trim();
  const templateNome = String(e.templateNome ?? '').trim();
  const variaveis = lerVariaveis(e.templateVariaveis);
  if (tipo === 'texto' && (texto === '' || texto.length > 4096)) return { ok: false, erro: 'texto invalido' };
  if (tipo === 'template' && templateNome === '') return { ok: false, erro: 'templateNome ausente' };
  if (variaveis === null) return { ok: false, erro: 'templateVariaveis invalido' };
  return { ok: true, pedido: {
    canalId, para, tipo, texto, templateNome, templateVariaveis: variaveis,
    identificar: e.identificarMayara === true || e.identificarMayara === 'true',
    origem: String(e.origem ?? ''),
  } };
}

export function montarCorpoMeta(p) {
  if (p.tipo === 'texto') {
    return { messaging_product: 'whatsapp', to: p.para, type: 'text', text: { body: p.identificar ? aplicarPrefixo(p.texto) : p.texto } };
  }
  const template = { name: p.templateNome, language: { code: 'pt_BR' } };
  if (p.templateVariaveis.length > 0) {
    template.components = [{ type: 'body', parameters: p.templateVariaveis.map((v) => ({ type: 'text', text: String(v) })) }];
  }
  return { messaging_product: 'whatsapp', to: p.para, type: 'template', template };
}

export function renderTemplate(corpo, variaveis) {
  const v = Array.isArray(variaveis) ? variaveis : [];
  return String(corpo ?? '').replace(/\{\{(\d+)\}\}/g, (_, n) => (v[Number(n) - 1] === undefined ? '' : String(v[Number(n) - 1])));
}

export function montarEvolution(p, corpoTemplate) {
  let texto = p.texto;
  if (p.tipo === 'template') {
    if (corpoTemplate === undefined || corpoTemplate === null) throw new Error('template sem texto equivalente cadastrado');
    texto = renderTemplate(corpoTemplate, p.templateVariaveis);
  }
  return { caminho: '/message/sendText/' + p.canalId, corpo: { number: p.para, text: p.identificar ? aplicarPrefixo(texto) : texto } };
}

export function atrasoHumanoMs(texto) {
  const n = String(texto ?? '').length;
  return Math.min(4000, Math.max(1000, 1000 + n * 20));
}

export function interpretarRespostaMeta(resposta) {
  const r = resposta && typeof resposta === 'object' ? resposta : {};
  const id = Array.isArray(r.messages) && r.messages[0] ? r.messages[0].id : undefined;
  if (!r.error && id) return { ok: true, ...r };
  let msg = 'erro_desconhecido';
  if (r.error) msg = typeof r.error === 'string' ? r.error : String(r.error.message ?? JSON.stringify(r.error));
  else if (!id) msg = 'resposta_sem_id_de_mensagem';
  return { ok: false, error: { message: msg } };
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd docs/superpowers/specs/2026-10-03-camada-canal && node --test canal.test.mjs`
Expected: todos PASS.

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/specs/2026-10-03-camada-canal/
git commit -m "feat(canal): biblioteca de montagem de envio e interpretacao de resposta

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Workflow `Canal: Enviar` (gerado, validado e publicado)

**Files:**
- Create: `docs/superpowers/specs/2026-10-03-camada-canal/gerar-enviar.mjs`
- Test: `docs/superpowers/specs/2026-10-03-camada-canal/gerar-enviar.test.mjs`
- Create (gerado): `docs/superpowers/specs/workflows/mayara-canal-enviar.json`

**Interfaces:**
- Consumes: `canal.mjs` (Task 2); `mayara.pode_enviar` e `mayara.registrar_envio` (Task 1).
- Produces: workflow `Mayara — Canal: Enviar [Sub-workflow]`, id anotado como `ENVIAR_ID`. **Entradas** (todas string): `canalId`, `para`, `tipo`, `texto`, `templateNome`, `templateVariaveis`, `identificarMayara`, `origem`. **Saída:** objeto no formato da Graph API (`{ ok:true, messaging_product, contacts, messages:[{id}] }` ou `{ ok:false, error:{message} }`).

- [ ] **Step 1: Escrever o teste estrutural (falha)**

Criar `gerar-enviar.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { montarWorkflow, corpoNode, RODAPE_PREPARAR, RODAPE_CORPO_META, RODAPE_INTERPRETAR } from './gerar-enviar.mjs';

const wf = montarWorkflow();
const nomes = wf.nodes.map((n) => n.name);

test('nomes unicos e conexoes validas', () => {
  assert.equal(new Set(nomes).size, nomes.length);
  for (const [origem, saidas] of Object.entries(wf.connections)) {
    assert.ok(nomes.includes(origem), origem);
    for (const tipo of Object.values(saidas)) for (const g of tipo) for (const c of g) assert.ok(nomes.includes(c.node), c.node);
  }
});

test('todo no e alcancavel a partir do gatilho', () => {
  const alvo = new Set(['Execute Workflow Trigger']);
  let mudou = true;
  while (mudou) {
    mudou = false;
    for (const [o, s] of Object.entries(wf.connections)) {
      if (!alvo.has(o)) continue;
      for (const t of Object.values(s)) for (const g of t) for (const c of g) if (!alvo.has(c.node)) { alvo.add(c.node); mudou = true; }
    }
  }
  for (const n of nomes) assert.ok(alvo.has(n), 'inalcancavel: ' + n);
});

test('os Code nodes gerados sao JS valido e sem import/export', () => {
  for (const r of [RODAPE_PREPARAR, RODAPE_CORPO_META, RODAPE_INTERPRETAR]) {
    const c = corpoNode(r);
    assert.ok(!/^\s*(import|export)\s/m.test(c));
    assert.doesNotThrow(() => new Function('$input', '$', c));
  }
});

test('Preparar valida e Interpretar mantem o formato da Graph API', () => {
  const $ = () => ({ first: () => ({ json: { pedido: { tipo: 'texto' } } }) });
  const prep = new Function('$input', '$', corpoNode(RODAPE_PREPARAR))(
    { first: () => ({ json: { canalId: '1', para: '+55 14 99702-2609', tipo: 'texto', texto: 'Oi', identificarMayara: 'true', origem: 't' } }) }, $);
  assert.equal(prep[0].json.valido, true);
  assert.equal(prep[0].json.pedido.para, '5514997022609');
  const ruim = new Function('$input', '$', corpoNode(RODAPE_PREPARAR))({ first: () => ({ json: { canalId: '', para: '1', tipo: 'x' } }) }, $);
  assert.equal(ruim[0].json.valido, false);
  assert.equal(ruim[0].json.resultado.ok, false);
  const interp = new Function('$input', '$', corpoNode(RODAPE_INTERPRETAR))(
    { first: () => ({ json: { messages: [{ id: 'wamid.1' }] } }) }, $);
  assert.equal(interp[0].json.resultado.messages[0].id, 'wamid.1');
});

test('configuracao: credenciais, workflow de erro e provedor evolution sem envio real', () => {
  assert.equal(wf.settings.errorWorkflow, 'CQyjBKLX0UheNh1q');
  const json = JSON.stringify(wf);
  assert.ok(json.includes('nNpCUIhnDuVvTApU') && json.includes('SChAKcHay4ghJVwe'));
  assert.ok(!json.includes('/message/sendText'), 'a fase 1 nao liga a Evolution');
  assert.ok(nomes.includes('Evolution Indisponivel'));
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd docs/superpowers/specs/2026-10-03-camada-canal && node --test gerar-enviar.test.mjs`
Expected: FAIL com `Cannot find module './gerar-enviar.mjs'`.

- [ ] **Step 3: Implementar o gerador**

Criar `gerar-enviar.mjs`:

```js
// gerar-enviar.mjs: gera o JSON do workflow "Mayara - Canal: Enviar".
// Uso: node gerar-enviar.mjs  (grava docs/superpowers/specs/workflows/mayara-canal-enviar.json)
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const PG = { postgres: { id: 'nNpCUIhnDuVvTApU', name: 'Postgres account' } };
const BEARER = { httpBearerAuth: { id: 'SChAKcHay4ghJVwe', name: 'Bearer Auth account' } };
const OPCOES_IF = { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 };
const id = (n) => `c9000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

export function corpoLib() {
  return readFileSync(join(dir, 'canal.mjs'), 'utf8').replace(/^export\s+/gm, '');
}

export const RODAPE_PREPARAR = `
const v = validarPedido($input.first().json);
if (!v.ok) return [{ json: { valido: false, resultado: { ok: false, error: { message: v.erro } } } }];
return [{ json: { valido: true, pedido: v.pedido } }];
`;

export const RODAPE_CORPO_META = `
const p = $('Decidir').first().json.pedido;
return [{ json: { pedido: p, corpo: montarCorpoMeta(p) } }];
`;

export const RODAPE_INTERPRETAR = `
const p = $('Corpo Meta').first().json.pedido;
return [{ json: { pedido: p, resultado: interpretarRespostaMeta($input.first().json) } }];
`;

export function corpoNode(rodape) {
  return corpoLib() + '\n' + rodape;
}

const regra = (valor) => ({
  conditions: { options: OPCOES_IF, conditions: [{ id: 'r-' + valor, leftValue: '={{ $json.rota }}', rightValue: valor,
    operator: { type: 'string', operation: 'equals' } }], combinator: 'and' },
  renameOutput: true, outputKey: valor,
});

export function montarWorkflow() {
  const nodes = [
    { id: id(1), name: 'Execute Workflow Trigger', type: 'n8n-nodes-base.executeWorkflowTrigger', typeVersion: 1.1, position: [0, 300],
      parameters: { inputSource: 'workflowInputs', workflowInputs: { values: ['canalId', 'para', 'tipo', 'texto', 'templateNome', 'templateVariaveis', 'identificarMayara', 'origem'].map((name) => ({ name, type: 'string' })) } } },
    { id: id(2), name: 'Preparar', type: 'n8n-nodes-base.code', typeVersion: 2, position: [220, 300], parameters: { jsCode: corpoNode(RODAPE_PREPARAR) } },
    { id: id(3), name: 'Valido?', type: 'n8n-nodes-base.if', typeVersion: 2.2, position: [440, 300],
      parameters: { conditions: { options: OPCOES_IF, conditions: [{ id: 'valido', leftValue: '={{ $json.valido === true }}', rightValue: true,
        operator: { type: 'boolean', operation: 'true', singleValue: true } }], combinator: 'and' }, options: {} } },
    { id: id(4), name: 'Retorno Invalido', type: 'n8n-nodes-base.code', typeVersion: 2, position: [660, 460],
      parameters: { jsCode: 'return [{ json: $input.first().json.resultado }];' } },
    { id: id(5), name: 'Pode Enviar', type: 'n8n-nodes-base.postgres', typeVersion: 2.6, position: [660, 300], credentials: PG,
      parameters: { operation: 'executeQuery', query: 'select mayara.pode_enviar($1, $2, $3) as r',
        options: { queryReplacement: '={{ [$json.pedido.canalId, $json.pedido.para, $json.pedido.tipo] }}' } } },
    { id: id(6), name: 'Decidir', type: 'n8n-nodes-base.code', typeVersion: 2, position: [880, 300],
      parameters: { jsCode: "const r = $input.first().json.r;\nconst p = $('Preparar').first().json.pedido;\nif (!r || r.ok !== true) return [{ json: { rota: 'negado', pedido: p, resultado: { ok: false, error: { message: (r && r.motivo) || 'sem_resposta_da_politica' } } } }];\nreturn [{ json: { rota: r.provedor, pedido: p } }];" } },
    { id: id(7), name: 'Roteador', type: 'n8n-nodes-base.switch', typeVersion: 3.2, position: [1100, 300],
      parameters: { rules: { values: ['meta', 'evolution', 'negado'].map(regra) }, options: {} } },
    { id: id(8), name: 'Corpo Meta', type: 'n8n-nodes-base.code', typeVersion: 2, position: [1320, 140], parameters: { jsCode: corpoNode(RODAPE_CORPO_META) } },
    { id: id(9), name: 'Enviar Meta', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.4, position: [1540, 140], credentials: BEARER, onError: 'continueRegularOutput',
      parameters: { method: 'POST', url: '=https://graph.facebook.com/v25.0/{{ $json.pedido.canalId }}/messages',
        authentication: 'genericCredentialType', genericAuthType: 'httpBearerAuth', sendBody: true, specifyBody: 'json',
        jsonBody: '={{ JSON.stringify($json.corpo) }}', options: { timeout: 25000 } } },
    { id: id(10), name: 'Interpretar Meta', type: 'n8n-nodes-base.code', typeVersion: 2, position: [1760, 140], parameters: { jsCode: corpoNode(RODAPE_INTERPRETAR) } },
    { id: id(11), name: 'Evolution Indisponivel', type: 'n8n-nodes-base.code', typeVersion: 2, position: [1320, 300],
      parameters: { jsCode: "const p = $input.first().json.pedido;\nreturn [{ json: { pedido: p, resultado: { ok: false, error: { message: 'provedor_evolution_nao_disponivel_nesta_fase' } } } }];" } },
    { id: id(12), name: 'Registrar Envio', type: 'n8n-nodes-base.postgres', typeVersion: 2.6, position: [1980, 300], credentials: PG,
      parameters: { operation: 'executeQuery', query: 'select mayara.registrar_envio($1, $2, $3, $4::jsonb) as r',
        options: { queryReplacement: '={{ [$json.pedido.canalId, $json.pedido.para, $json.pedido.tipo, JSON.stringify($json.resultado)] }}' } } },
    { id: id(13), name: 'Retorno', type: 'n8n-nodes-base.code', typeVersion: 2, position: [2200, 300],
      parameters: { jsCode: 'return [{ json: $input.first().json.r }];' } },
  ];
  const ligar = (...destinos) => ({ main: [destinos.map((node) => ({ node, type: 'main', index: 0 }))] });
  const connections = {
    'Execute Workflow Trigger': ligar('Preparar'),
    'Preparar': ligar('Valido?'),
    'Valido?': { main: [[{ node: 'Pode Enviar', type: 'main', index: 0 }], [{ node: 'Retorno Invalido', type: 'main', index: 0 }]] },
    'Pode Enviar': ligar('Decidir'),
    'Decidir': ligar('Roteador'),
    'Roteador': { main: [
      [{ node: 'Corpo Meta', type: 'main', index: 0 }],
      [{ node: 'Evolution Indisponivel', type: 'main', index: 0 }],
      [{ node: 'Registrar Envio', type: 'main', index: 0 }],
    ] },
    'Corpo Meta': ligar('Enviar Meta'),
    'Enviar Meta': ligar('Interpretar Meta'),
    'Interpretar Meta': ligar('Registrar Envio'),
    'Evolution Indisponivel': ligar('Registrar Envio'),
    'Registrar Envio': ligar('Retorno'),
  };
  return {
    name: 'Mayara — Canal: Enviar [Sub-workflow]',
    nodes, connections,
    settings: { executionOrder: 'v1', errorWorkflow: 'CQyjBKLX0UheNh1q', callerPolicy: 'workflowsFromSameOwner' },
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const destino = join(dir, '..', 'workflows', 'mayara-canal-enviar.json');
  writeFileSync(destino, JSON.stringify(montarWorkflow(), null, 2));
  console.log('gravado', destino);
}
```

- [ ] **Step 4: Rodar a suíte e ver passar**

Run: `cd docs/superpowers/specs/2026-10-03-camada-canal && node --test`
Expected: todos PASS (Task 2 e Task 3).

- [ ] **Step 5: Gerar o JSON, verificar invisíveis e commitar**

```bash
cd docs/superpowers/specs/2026-10-03-camada-canal && node gerar-enviar.mjs
python3 - <<'E'
import re
s=open('../workflows/mayara-canal-enviar.json',encoding='utf8').read()
print('invisiveis:',[hex(ord(m.group())) for m in re.finditer(r'[̀-ͯ​-‏  ﻿]',s)])
E
cd ../../../.. && git add docs/superpowers/specs/2026-10-03-camada-canal docs/superpowers/specs/workflows/mayara-canal-enviar.json
git commit -m "feat(canal): gerador do workflow Canal Enviar

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```
Expected: `invisiveis: []`.

- [ ] **Step 6: Criar o workflow no n8n e publicar**

1. Ler o JSON gerado e chamar `n8n_create_workflow` com `name`, `nodes`, `connections` e `settings` exatamente como estão no arquivo.
2. Anotar o `id` retornado como `ENVIAR_ID` (e acrescentá-lo como `"id"` na raiz do JSON versionado).
3. `n8n_validate_workflow` com `options: {"profile":"minimal"}`. Expected: `valid: true`, 13 nós, 0 conexões inválidas (se a validação padrão cair, repetir).
4. `n8n_update_partial_workflow` com `[{"type":"activateWorkflow"}]` (reler antes de repetir). Expected: `active: true`.

- [ ] **Step 7: Commit do id**

```bash
git add docs/superpowers/specs/workflows/mayara-canal-enviar.json
git commit -m "feat(canal): cria o workflow Canal Enviar no n8n

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Trocar os 8 pontos de envio por chamadas ao `Canal: Enviar`

**Files:**
- Modify (n8n, um por vez): Central `jNhj68Ee7i3w8dey` (nó `Responder`); Ponte `B1xdt1WotCQE3NOb` (nós `Enviar via Graph API` e `Enviar Pausa via Graph API`); Follow-up `CxlC28G0S3uE8X66` (nó `f7`); Lembretes `YlRXMT6gEopuwFof`; Alertar Escritório `FWSC1k1CBMWBtsNs`; Alertas de Erros `CQyjBKLX0UheNh1q`; Receber Lead do Formulário `u7BM28YtcvFetEAz` (inativo).
- Modify: os exports versionados correspondentes em `docs/superpowers/specs/workflows/`.

**Interfaces:**
- Consumes: `ENVIAR_ID` (Task 3). Contrato de entrada do `Canal: Enviar` (strings). A única leitura da resposta no sistema é o `Envio OK?` da Ponte (`!$json.error && Array.isArray($json.messages) && Boolean($json.messages[0]?.id)`), compatível com a saída.

**Modelo de troca (vale para todos os pontos).** Cada nó `httpRequest` de envio vira um nó `executeWorkflow` no mesmo lugar, com `updateNode` (`type`, `typeVersion: 1.3`, `credentials: null`, `parameters`), preservando conexões e posição. Parâmetros comuns:

```json
{"workflowId":{"__rl":true,"value":"ENVIAR_ID","mode":"list","cachedResultName":"Mayara — Canal: Enviar [Sub-workflow]"},
 "workflowInputs":{"mappingMode":"defineBelow","value":{ ...entradas do ponto... },"matchingColumns":[],
  "schema":[ {"id":"canalId"},{"id":"para"},{"id":"tipo"},{"id":"texto"},{"id":"templateNome"},{"id":"templateVariaveis"},{"id":"identificarMayara"},{"id":"origem"} ],
  "attemptToConvertTypes":false,"convertFieldsToString":false},
 "options":{"waitForSubWorkflow":true}}
```
(no `schema`, cada item é `{"id":"<nome>","displayName":"<nome>","required":false,"defaultMatch":false,"display":true,"type":"string","canBeUsedToMatch":true}`). `onError` do nó permanece o que já era (`continueRegularOutput`; no follow-up não havia, e passa a ser `continueRegularOutput`).

**Entradas por ponto** (`tipo` e `origem` são texto fixo; o resto é expressão):

| Ponto (id do nó) | canalId | para | tipo | texto / template | identificarMayara | origem |
|---|---|---|---|---|---|---|
| Central `Responder` (`c8000000-0000-4000-8000-000000000020`) | `={{ $('Classificar').first().json.phoneNumberId }}` | `={{ $('Classificar').first().json.phone }}` | `texto` | texto `={{ $json.resposta }}` | `false` | `central` |
| Ponte `Enviar via Graph API` (`dc2e5af8-3aae-493b-9994-5b55692842b9`) | `={{ $("Entrada").item.json.phoneNumberId }}` | `={{ $("Entrada").item.json.phone }}` | `texto` | texto `={{ (typeof $('Chamar Mayara').item.json.output === 'string' && $('Chamar Mayara').item.json.output.trim()) ? $('Chamar Mayara').item.json.output : 'Tivemos uma instabilidade no atendimento. Sua mensagem foi encaminhada para nossa equipe, que continuará o contato por este WhatsApp.' }}` | `true` | `ponte` |
| Ponte `Enviar Pausa via Graph API` (`a0c78c89-2d7d-4d4f-a8f7-b15b46ab36d0`) | `={{ $("Entrada").item.json.phoneNumberId }}` | `={{ $("Entrada").item.json.phone }}` | `texto` | texto `No momento, o atendimento automático está temporariamente pausado. Nossa equipe vai continuar o seu atendimento por este WhatsApp.` | `true` | `ponte_pausa` |
| Follow-up `f7` | `={{ $json.phone_number_id }}` | `={{ $json.phone }}` | `texto` | texto `={{ $json.textoFollowUp }}` | `true` | `followup` |
| Lembretes (`5a577097-132d-4338-9516-1b914818198c`) | `={{ $json.phone_number_id }}` | `={{ $json.phone }}` | `template` | templateNome `={{ $json.templateNome }}`, templateVariaveis `={{ JSON.stringify($json.templateVariaveis) }}` | `false` | `lembrete` |
| Alertar Escritório (`a5000000-0000-4000-8000-000000000002`) | `1365007506685934` | `5514997022609` | `texto` | texto `={{ $json.texto }}` | `false` | `alerta_escritorio` |
| Alertas de Erros (`c2222222-2222-4222-8222-222222222222`) | `1365007506685934` | `5514997022609` | `texto` | texto = a mesma concatenação do corpo atual (ver Step 4) | `false` | `alerta_erro` |
| Receber Lead do Formulário (`c6000000-0000-4000-8000-000000000016`) | `1365007506685934` | `={{ $('Validar e Normalizar').item.json.telefone }}` | `template` | templateNome `primeiro_contato_campanha`, templateVariaveis `[]` | `false` | `formulario` |

Campos não usados por um ponto ficam como string vazia `""`.

- [ ] **Step 1: Ponto de rollback e ordem**

Anotar o `versionId` de cada workflow antes de mexer (`n8n_workflow_versions`, mode `list`). Ordem: Central, Ponte (resposta), Ponte (pausa), Follow-up, Lembretes, Alertar Escritório, Alertas de Erros, Formulário.

- [ ] **Step 2: Central (`Responder`)**

Trocar o nó (um único `updateNode`), ler o nó de volta e `n8n_validate_workflow` (minimal). Teste ao vivo: pedir ao usuário que mande `/ajuda` pelo WhatsApp. Expected: a lista de comandos chega; `select * from mayara.envios_log order by id desc limit 1` mostra `ok = true` e um `provedor_message_id`. Se falhar, `n8n_workflow_versions` rollback e investigar a execução do `Canal: Enviar`.

- [ ] **Step 3: Ponte (resposta e pausa)**

Trocar `Enviar via Graph API` e validar. Teste ao vivo: o usuário manda uma mensagem de lead; a resposta chega com `*Mayara:*` uma única vez; o `Envio OK?` segue o ramo de sucesso (conferir a execução da Ponte) e há nova linha em `envios_log`. Depois trocar `Enviar Pausa via Graph API` e validar; teste ao vivo opcional (com autorização): `/desligar`, uma mensagem de lead, `/ligar` (cria uma Task de transferência humana no CRM).

- [ ] **Step 4: Demais pontos**

Follow-up, Lembretes, Alertar Escritório, Alertas de Erros e Formulário: trocar um por vez, ler de volta e validar. Para os Alertas de Erros, o texto do pedido é a expressão que já estava no `jsonBody`:

```
={{ '⚠️ Erro no n8n\n\nWorkflow: ' + ($json.workflow && $json.workflow.name || 'desconhecido') + '\nErro: ' + ($json.execution && $json.execution.error && $json.execution.error.message || 'sem detalhe') + '\nExecução: ' + ($json.execution && $json.execution.url || '') }}
```

Estes cinco não têm gatilho de teste imediato (follow-up e lembretes dependem do agendador, os alertas dependem de falhas reais, o formulário está inativo): a verificação é estrutural (leitura do nó, `validate_workflow` minimal) e fica registrada como "validada na próxima execução real".

- [ ] **Step 5: Atualizar os exports versionados**

Para cada workflow trocado, substituir o nó correspondente no JSON de `docs/superpowers/specs/workflows/` pelo novo nó, com este script (rodar uma vez por nó, ajustando os três argumentos):

```bash
python3 - <<'E'
import json
def trocar(arquivo, id_no, novo):
    d = json.load(open(arquivo, encoding='utf8')); raiz = d.get('data', d)
    for i, n in enumerate(raiz['nodes']):
        if n['id'] == id_no:
            raiz['nodes'][i] = {**novo, 'id': n['id'], 'name': n['name'], 'position': n['position']}
            json.dump(d, open(arquivo, 'w', encoding='utf8'), ensure_ascii=False, indent=2); return
    raise SystemExit('no nao encontrado: ' + id_no)
# exemplo: trocar('docs/superpowers/specs/workflows/mayara-central-de-comando.json', 'c8000000-0000-4000-8000-000000000020', {...novo no...})
E
```

O `<DESTINATARIO_DOS_ALERTAS>` mascarado nos exports permanece mascarado (não gravar o número real nos arquivos).

- [ ] **Step 6: Regressão final dos envios**

Com o usuário: um lead de teste completo (oi, qualificação, escolha de horário) e `/status`. Expected: respostas normais, prefixo único, `envios_log` com uma linha por mensagem enviada e todas `ok = true`.

- [ ] **Step 7: Commit**

```bash
git add docs/superpowers/specs/workflows/
git commit -m "feat(canal): envios da Mayara passam a usar o Canal Enviar

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Extrair `Canal: Processar Evento` do Gateway

**Files:**
- Create: `docs/superpowers/specs/2026-10-03-camada-canal/gerar-processar.mjs`
- Test: `docs/superpowers/specs/2026-10-03-camada-canal/gerar-processar.test.mjs`
- Create (gerado): `docs/superpowers/specs/workflows/mayara-canal-processar-evento.json`
- Modify (n8n): Gateway `FV0PEtEcTFbuoRaO`
- Modify: `docs/superpowers/specs/workflows/whatsapp-gateway-seguro.json`

**Interfaces:**
- Consumes: o evento normalizado produzido por `Normalizar e Filtrar Evento` (campos `accepted`, `reason`, `phone`, `message`, `messageType`, `messageId`, `phoneNumberId`, `sessionKey`, `requiresHuman`...); `CENTRAL_ID = jNhj68Ee7i3w8dey`; Ponte `B1xdt1WotCQE3NOb`.
- Produces: workflow `Mayara — Canal: Processar Evento [Sub-workflow]` (id `PROCESSAR_ID`) com gatilho `passthrough` (recebe o item inteiro). Faz tudo o que hoje o Gateway faz depois de `Normalizar e Filtrar Evento`: `Tem Mensagem?` → `Rota da Mensagem` → `Comando?` → (Central) ou `Consultar Autorização` → `Liberado?` → `Restaurar Evento` → `Evento Autorizado?` → `Requer Atendimento Humano?` → Ponte.

- [ ] **Step 1: Escrever o teste estrutural (falha)**

Criar `gerar-processar.test.mjs` com as mesmas verificações de nomes únicos, conexões válidas e alcançabilidade da Task 3, e estas específicas:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { montarWorkflow } from './gerar-processar.mjs';

const wf = montarWorkflow('jNhj68Ee7i3w8dey');
const nomes = wf.nodes.map((n) => n.name);
const sai = (o, i) => (wf.connections[o]?.main?.[i] ?? []).map((c) => c.node);

test('nomes unicos, conexoes validas e tudo alcancavel', () => {
  assert.equal(new Set(nomes).size, nomes.length);
  const alvo = new Set(['Execute Workflow Trigger']);
  let mudou = true;
  while (mudou) {
    mudou = false;
    for (const [o, s] of Object.entries(wf.connections)) {
      assert.ok(nomes.includes(o), o);
      for (const g of s.main) for (const c of g) { assert.ok(nomes.includes(c.node), c.node); if (alvo.has(o) && !alvo.has(c.node)) { alvo.add(c.node); mudou = true; } }
    }
  }
  for (const n of nomes) assert.ok(alvo.has(n), 'inalcancavel: ' + n);
});

test('o gatilho aceita o item inteiro (passthrough)', () => {
  assert.equal(wf.nodes.find((n) => n.name === 'Execute Workflow Trigger').parameters.inputSource, 'passthrough');
});

test('nenhuma expressao depende de nos que so existem no Gateway', () => {
  assert.ok(!JSON.stringify(wf).includes("Normalizar e Filtrar Evento"));
});

test('fail-closed: erros da rota e do portao param com erro, e administrador nunca cai no fluxo de lead', () => {
  assert.deepEqual(sai('Rota da Mensagem', 1), ['Falha da Rota']);
  assert.deepEqual(sai('Consultar Autorização', 1), ['Falha do Portão (fecha e alerta)']);
  assert.deepEqual(sai('Comando?', 0), ['Executar Central']);
  assert.deepEqual(sai('Comando?', 1), ['Consultar Autorização']);
  assert.deepEqual(sai('Liberado?', 1), ['Bloqueado em Silêncio']);
});

test('eventos sem mensagem seguem para Evento Autorizado? sem consultar o banco', () => {
  assert.deepEqual(sai('Tem Mensagem?', 1), ['Evento Autorizado?']);
  assert.deepEqual(sai('Tem Mensagem?', 0), ['Rota da Mensagem']);
});

test('a Ponte e chamada com os mesmos oito campos de hoje', () => {
  const ponte = wf.nodes.find((n) => n.name === 'Chamar Mayara — Ponte WhatsApp');
  assert.deepEqual(Object.keys(ponte.parameters.workflowInputs.value).sort(),
    ['channel', 'message', 'messageId', 'phone', 'phoneNumberId', 'requiresHuman', 'sessionKey', 'timestamp']);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd docs/superpowers/specs/2026-10-03-camada-canal && node --test gerar-processar.test.mjs`
Expected: FAIL com `Cannot find module './gerar-processar.mjs'`.

- [ ] **Step 3: Implementar o gerador**

Criar `gerar-processar.mjs` exportando `montarWorkflow(centralId)`. Os 14 nós e seus parâmetros são os **mesmos que estão hoje no Gateway** (copiados do export versionado `whatsapp-gateway-seguro.json`, ids e parâmetros dos nós `Tem Mensagem?`, `Rota da Mensagem`, `Comando?`, `Executar Central`, `Falha da Rota`, `Consultar Autorização`, `Liberado?`, `Restaurar Evento`, `Bloqueado em Silêncio`, `Falha do Portão (fecha e alerta)`, `Evento Autorizado?`, `Requer Atendimento Humano?`, `Ignorar Evento com Seguranca`, `Chamar Mayara — Ponte WhatsApp`), com estas diferenças obrigatórias:

1. Gatilho novo: `{ name: 'Execute Workflow Trigger', type: 'n8n-nodes-base.executeWorkflowTrigger', typeVersion: 1.1, parameters: { inputSource: 'passthrough' } }`, ligado a `Tem Mensagem?`.
2. `Restaurar Evento`: `jsCode` = `return [{ json: $('Execute Workflow Trigger').first().json }];`
3. `Executar Central`: cada valor de entrada lê de `$('Execute Workflow Trigger').first().json.<campo>` (`phone`, `message`, `messageId`, `phoneNumberId`) e o `workflowId` é `centralId`.
4. `Chamar Mayara — Ponte WhatsApp` mapeia `sessionKey`, `messageId`, `phone`, `message`, `timestamp`, `channel`, `phoneNumberId`, `requiresHuman` a partir de `$json` (como hoje) e continua com `waitForSubWorkflow: true` e `onError: continueRegularOutput`.
5. As conexões são as do Gateway a partir de `Tem Mensagem?`, mais `Execute Workflow Trigger → Tem Mensagem?`.

Escrever o arquivo copiando literalmente os objetos de nó do export (por script ou à mão) e rodar a suíte.

- [ ] **Step 4: Rodar a suíte e ver passar**

Run: `cd docs/superpowers/specs/2026-10-03-camada-canal && node --test`
Expected: todos PASS.

- [ ] **Step 5: Gerar, criar no n8n, validar e publicar**

1. `node gerar-processar.mjs` grava `mayara-canal-processar-evento.json`; conferir ausência de invisíveis (script do Task 3, Step 5).
2. `n8n_create_workflow` com o conteúdo; anotar `PROCESSAR_ID` e acrescentar `"id"` ao JSON.
3. `n8n_validate_workflow` (minimal): `valid: true`.
4. Publicar com `activateWorkflow` (reler antes de repetir).

- [ ] **Step 6: Ponto de rollback e virada do Gateway**

1. Anotar a versão do Gateway (`n8n_workflow_versions`).
2. Adicionar ao Gateway um nó `noOp` chamado `Processar Evento` ligado à saída de `Normalizar e Filtrar Evento` (em paralelo ao `Tem Mensagem?` atual). Converter com `updateNode` em `executeWorkflow` apontando para `PROCESSAR_ID` (`workflowInputs.mappingMode: autoMapInputData`, `waitForSubWorkflow: true`, `onError: continueRegularOutput`). Ler de volta.
3. **Virada numa única chamada:** `removeConnection` de `Normalizar e Filtrar Evento → Tem Mensagem?`. A partir daí o fluxo vivo é o novo.
4. Teste ao vivo imediato: o usuário manda "oi" do número de teste e `/status`. Expected: respostas normais; na execução do Gateway aparece `Processar Evento`; na execução do sub-workflow aparecem `Rota da Mensagem` e `Consultar Autorização`. Se algo falhar: reconectar `Normalizar → Tem Mensagem?` (ou `n8n_workflow_versions` rollback).

- [ ] **Step 7: Remover os nós antigos do Gateway**

Com a virada estável, remover do Gateway os 14 nós que agora existem no sub-workflow (`removeNode`, 3 a 4 por chamada, lendo de volta a cada chamada; o validador exige que não restem nós soltos). Ao final, `n8n_validate_workflow` (minimal) do Gateway: `valid: true`, e o Gateway fica com `Meta - Verificar Webhook`, `Validar Desafio Meta`, `Responder Desafio Meta`, `Meta - Receber Eventos`, `Calcular HMAC Meta`, `Assinatura Válida?`, `Normalizar e Filtrar Evento`, `Processar Evento` e `Ignorar Evento com Seguranca`.

- [ ] **Step 8: Regressão completa e exports**

Roteiro com o usuário: lead de teste (oi e uma pergunta), `/status`, `/regras`, áudio ou imagem de um segundo telefone (deve ser ignorado ou ir para humano como hoje, conferindo que um número não cadastrado continua em silêncio). Atualizar `whatsapp-gateway-seguro.json` (9 nós + conexões; manter token e telefone mascarados) e commitar:

```bash
git add docs/superpowers/specs/2026-10-03-camada-canal docs/superpowers/specs/workflows/
git commit -m "feat(canal): extrai o processamento de eventos do Gateway para um sub-workflow

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Fechamento da fase 1

**Files:**
- Modify: `docs/superpowers/specs/2026-10-03-camada-de-canal-whatsapp-design.md` (seção "Conclusão da fase 1")

- [ ] **Step 1: Verificação final**

`select count(*), count(*) filter (where ok), count(*) filter (where not ok) from mayara.envios_log;` e leitura das últimas execuções de erro do n8n (`n8n_executions` com `status: error`). Expected: nenhum erro novo atribuível à camada de canal.

- [ ] **Step 2: Registrar a conclusão**

Acrescentar à spec a seção "Conclusão da fase 1" com: ids dos workflows (`ENVIAR_ID`, `PROCESSAR_ID`), o resultado dos testes ao vivo, os pontos validados só estruturalmente, e o que a fase 2 ainda precisa (credencial de e-mail no n8n, Evolution no Coolify com Postgres e Redis, payloads reais). Commitar:

```bash
git add docs/superpowers/specs/2026-10-03-camada-de-canal-whatsapp-design.md
git commit -m "docs: conclui a fase 1 da camada de canal do WhatsApp

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Self-Review

**Cobertura da spec (fase 1):** tabelas, política de envio e auditoria (Task 1); contrato de pedido, prefixo, corpos Meta e Evolution, atraso humano e resposta compatível com a Graph API (Task 2); `Canal: Enviar` único (Task 3); os 8 pontos de envio trocados um a um (Task 4); `Canal: Processar Evento` extraído do Gateway (Task 5); conclusão (Task 6). Fica para o plano da fase 2: `Canal: Receber Evolution`, `Canal: Estado`, credencial de e-mail, o provedor `evolution` em `Canal: Enviar` e o modo de observação.

**Placeholders:** `ENVIAR_ID` e `PROCESSAR_ID` são ids produzidos nas Tasks 3 e 5 e consumidos nas Tasks 4 e 5; `CENTRAL_ID` já existe (`jNhj68Ee7i3w8dey`). A Task 5, Step 3, aponta para o export versionado do Gateway como fonte literal dos 14 nós, em vez de reescrevê-los aqui.

**Consistência de nomes:** as entradas do `Canal: Enviar` (`canalId`, `para`, `tipo`, `texto`, `templateNome`, `templateVariaveis`, `identificarMayara`, `origem`) são as mesmas na biblioteca, no gerador e na tabela da Task 4. `pode_enviar` e `registrar_envio` têm as assinaturas usadas nas queries do workflow.

**Riscos assumidos:** a ferramenta de edição do n8n é instável. O plano troca um ponto por vez, lê de volta e mantém rollback por versão. A Task 5 é a mais arriscada (mexe no caminho de todo lead) e vem por último, com a virada e a remoção em passos separados.
