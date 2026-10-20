import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ARRANJO_PADRAO } from '@/lib/layout';
import { IDS_DO_CATALOGO } from '@/lib/widgets';

vi.mock('./actions', () => ({ salvarArranjo: async () => ({ ok: true }) }));
vi.mock('react-grid-layout/css/styles.css', () => ({}));
vi.mock('react-resizable/css/styles.css', () => ({}));

import Grade from './Grade';

const quadros = Object.fromEntries(IDS_DO_CATALOGO.map((id) => [id, createElement('p', null, `corpo-${id}`)])) as unknown as Parameters<typeof Grade>[0]["quadros"];

describe('Grade, primeira renderização (a do servidor)', () => {
  const html = renderToStaticMarkup(createElement(Grade, { arranjo: ARRANJO_PADRAO, quadros }));

  it('empilha em uma coluna com a fila primeiro, igual ao celular', () => {
    expect(html.indexOf('corpo-fila')).toBeGreaterThan(-1);
    expect(html.indexOf('corpo-fila')).toBeLessThan(html.indexOf('corpo-kpi-leads-novos'));
    expect(html).toContain('p-pilha');
  });

  it('não oferece arrastar nem Configurar antes de medir a largura', () => {
    expect(html).not.toContain('Configurar');
    expect(html).not.toContain('Esconder');
  });

  it('mostra todos os quadros do arranjo e deixa de fora os escondidos', () => {
    const escondido = { versao: 1 as const, itens: ARRANJO_PADRAO.itens.map((i) => (i.id === 'fontes' ? { ...i, oculto: true } : i)) };
    const h = renderToStaticMarkup(createElement(Grade, { arranjo: escondido, quadros }));
    expect(h).not.toContain('corpo-fontes');
    expect(h).toContain('corpo-tempo-resposta');
  });
});
