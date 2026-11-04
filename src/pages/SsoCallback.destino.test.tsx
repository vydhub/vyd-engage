import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';

/**
 * Link do Flow sem sessão no Engage (spec captura-demandas, E-20): a pessoa passa pelo VYD ID e
 * volta para a página de criação com os dados preenchidos, sem precisar voltar ao Flow.
 */
const auth = vi.hoisted(() => ({
  user: null as null | { role: string },
  refreshUser: vi.fn(async () => {}),
}));
const api = vi.hoisted(() => ({ ssoExchange: vi.fn(async () => {}) }));

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ user: auth.user, loading: false, refreshUser: auth.refreshUser }),
}));
vi.mock('../services/api/client', async (original) => ({
  ...(await original<typeof import('../services/api/client')>()),
  apiClient: api,
}));

import { RequireAuth } from '../components/RequireAuth';
import { CHAVE_DESTINO } from '../utils/destinoAposLogin';
import { SsoCallback } from './SsoCallback';

function Onde() {
  const { pathname, search } = useLocation();
  return <p>Em {pathname + search}</p>;
}

function abrir(url: string) {
  render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/login" element={<p>Tela de login</p>} />
        <Route path="/sso" element={<SsoCallback />} />
        <Route
          path="/app/*"
          element={
            <RequireAuth>
              <Onde />
            </RequireAuth>
          }
        />
      </Routes>
    </MemoryRouter>
  );
}

const LINK = '/app/companies?novo=1&nome=Cliente%20Novo&cnpj=123&dominio=cliente.com.br';

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  auth.user = null;
  window.location.hash = '';
});

describe('destino depois do login pelo VYD ID (E-20)', () => {
  it('sem sessão: guarda a rota com os parâmetros e vai para o login', async () => {
    abrir(LINK);
    expect(await screen.findByText('Tela de login')).toBeTruthy();
    expect(sessionStorage.getItem(CHAVE_DESTINO)).toBe(LINK);
  });

  it('com sessão: não guarda nada', async () => {
    auth.user = { role: 'ADMIN' };
    abrir(LINK);
    expect(await screen.findByText(`Em ${LINK}`)).toBeTruthy();
    expect(sessionStorage.getItem(CHAVE_DESTINO)).toBeNull();
  });

  it('caminho completo: do link, pelo login, de volta ao link', async () => {
    abrir(LINK);
    await screen.findByText('Tela de login');
    document.body.innerHTML = '';

    auth.user = { role: 'ADMIN' };
    window.location.hash = '#vyd_token=abc';
    abrir('/sso');

    expect(await screen.findByText(`Em ${LINK}`)).toBeTruthy();
    expect(api.ssoExchange).toHaveBeenCalledWith('abc');
    expect(sessionStorage.getItem(CHAVE_DESTINO)).toBeNull();
  });

  it('redirect_to do portal vale mais que o guardado, e a chave é limpa do mesmo jeito', async () => {
    sessionStorage.setItem(CHAVE_DESTINO, LINK);
    auth.user = { role: 'ADMIN' };
    window.location.hash = '#vyd_token=abc&redirect_to=/app/deals';
    abrir('/sso');
    expect(await screen.findByText('Em /app/deals')).toBeTruthy();
    expect(sessionStorage.getItem(CHAVE_DESTINO)).toBeNull();
  });

  it('destino guardado passa pela mesma conferência: domínio externo não vale', async () => {
    sessionStorage.setItem(CHAVE_DESTINO, '//malicioso.com/app');
    auth.user = { role: 'ADMIN' };
    window.location.hash = '#vyd_token=abc';
    abrir('/sso');
    expect(await screen.findByText('Em /app')).toBeTruthy();
  });

  it('falha na troca do token: mantém o destino para a próxima tentativa', async () => {
    api.ssoExchange.mockRejectedValueOnce(new Error('Falhou'));
    sessionStorage.setItem(CHAVE_DESTINO, LINK);
    window.location.hash = '#vyd_token=abc';
    abrir('/sso');
    await waitFor(() => expect(screen.getByText('Falhou')).toBeTruthy());
    expect(sessionStorage.getItem(CHAVE_DESTINO)).toBe(LINK);
  });

  it('sessionStorage bloqueado não derruba o login', async () => {
    const espia = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('bloqueado');
    });
    abrir(LINK);
    expect(await screen.findByText('Tela de login')).toBeTruthy();
    espia.mockRestore();
  });
});
