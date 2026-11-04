// Callback do SSO VYD ID (portal id.vydhub.com). O portal redireciona para
// /sso#vyd_token=<jwt>&redirect_to=<rota-interna-opcional> — FRAGMENTO da URL,
// que nunca chega ao servidor.
//
// Fluxo: ler o fragmento → limpar a URL com history.replaceState ANTES de
// qualquer await (o token não pode ficar no histórico) → POST do token em
// /auth/sso/exchange (cookies httpOnly setados pelo backend) → refreshUser()
// do AuthContext → navegar para redirect_to (se válido), para a rota que a pessoa tentou
// abrir sem sessão (RequireAuth) ou para /app.
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { AlertCircle, Loader2 } from 'lucide-react';
import { apiClient } from '../services/api/client';
import { useAuth } from '../contexts/AuthContext';
import { lerDestino, limparDestino } from '../utils/destinoAposLogin';

const VYD_ID_PORTAL_URL = 'https://id.vydhub.com';

// redirect_to só é aceito se for rota interna: começa com "/" e não com "//"
// (protocol-relative levaria para domínio externo — open redirect).
function safeRedirect(target: string | null): string {
  if (target && target.startsWith('/') && !target.startsWith('//')) return target;
  return '/app';
}

export function SsoCallback() {
  const navigate = useNavigate();
  const { refreshUser } = useAuth();
  const [error, setError] = useState('');
  // Guarda contra dupla execução do efeito (React StrictMode monta 2x em dev) —
  // o fragmento é consumido uma única vez; a 2ª execução não teria mais o token.
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    const params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const token = params.get('vyd_token');
    const redirectTo = safeRedirect(params.get('redirect_to') ?? lerDestino());

    // Limpa o token da URL imediatamente (histórico/barra de endereço).
    window.history.replaceState(null, '', window.location.pathname + window.location.search);

    if (!token) {
      setError('Link de acesso inválido: o token do VYD ID não foi encontrado.');
      return;
    }

    (async () => {
      try {
        await apiClient.ssoExchange(token);
        await refreshUser();
        limparDestino();
        navigate(redirectTo, { replace: true });
      } catch (err) {
        setError(
          err instanceof Error && err.message
            ? err.message
            : 'Não foi possível concluir o acesso via VYD ID. Tente novamente.'
        );
      }
    })();
  }, [navigate, refreshUser]);

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-6">
        <div className="w-full max-w-md bg-card border border-border rounded-lg p-8 text-center">
          <AlertCircle size={48} className="text-destructive mx-auto mb-4" />
          <h1 className="text-xl font-semibold text-foreground mb-2">
            Não foi possível entrar
          </h1>
          <p className="text-sm text-muted-foreground mb-6">{error}</p>
          <a
            href={VYD_ID_PORTAL_URL}
            className="inline-flex items-center justify-center w-full h-11 rounded-lg bg-primary text-primary-foreground font-medium hover:bg-primary/90 transition-colors"
          >
            Voltar ao portal VYD ID
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-6">
      <div className="flex flex-col items-center gap-4 text-center">
        <Loader2 size={32} className="animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">Entrando com o VYD ID…</p>
      </div>
    </div>
  );
}
