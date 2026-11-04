import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

/**
 * O produto aparece para as pessoas como Radar (emenda de 03/11 da spec-mãe). Rotas, escopos e
 * identificadores seguem com "captura".
 */
const api = vi.hoisted(() => ({
  getApiKeys: vi.fn(async () => [
    {
      id: 'k1',
      name: 'Chave do Radar',
      key: 'fcrm_****abcd',
      scopes: ['contracts:read', 'captura:write'],
      createdAt: '2026-11-03T10:00:00Z',
      lastUsedAt: null,
    },
  ]),
}));
vi.mock('../services/api/client', async (original) => ({
  ...(await original<typeof import('../services/api/client')>()),
  apiClient: api,
}));

import { categories } from '../components/shell/nav';
import { screenTitleFor } from './screenTitles';
import { ApiKeysTab } from '../components/settings/ApiKeysTab';

describe('nome Radar no texto visível', () => {
  it('menu e título da tela do relatório dizem Radar, na mesma rota', () => {
    const item = categories
      .flatMap((c) => c.items)
      .find((i) => 'path' in i && i.path === '/app/reports/captura');
    expect(item?.label).toBe('Radar');
    expect(screenTitleFor('/app/reports/captura')).toBe('Radar');
  });

  it('escopo da chave aparece como Radar, e o identificador segue captura:write', async () => {
    render(<ApiKeysTab />);
    expect(await screen.findByText('Radar: Escrever')).toBeTruthy();
    expect(screen.queryByText(/Captura/)).toBeNull();
  });
});
