/*
 * CORTE DO LOGIN NATIVO (Onda 4 / Pacote 2 — decisão do dono, 07/08/2026).
 *
 * A identidade mora no VYD ID (id.vydhub.com) e chega aqui pelo token
 * exchange da rota `/sso` (SsoCallback). Esta tela NÃO tem — e não pode
 * voltar a ter — formulário de senha, cadastro ou "esqueci minha senha":
 * as rotas correspondentes foram removidas do backend
 * (`server/src/routes/auth.ts`), então um formulário aqui só produziria erro.
 *
 * Quem não consegue entrar usa o resgate do próprio IdP (edge
 * `request-access`), que dispara link de acesso a quem tem conta e registra
 * o pedido de quem não tem — sempre com a MESMA resposta na tela, para não
 * revelar quem existe (anti-enumeração).
 */
import React, { useCallback, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { VYDEcosystemBanner } from '../components/VYDEcosystemBanner';
import { ArrowLeft, Shield } from 'lucide-react';

const VYD_ID_URL = 'https://id.vydhub.com';
const REQUEST_ACCESS_URL =
  'https://pbtwlevrsenltnorgbpz.supabase.co/functions/v1/request-access';

/** Resposta única: com sucesso ou com erro, a tela diz exatamente isto. */
const RESPOSTA_PADRAO =
  'Se houver uma conta VYD ID com esse e-mail, você receberá um link de acesso. ' +
  'Caso contrário, registramos seu pedido e a equipe vai avaliar.';

export function Login() {
  // `?ajuda=1` (ou `?error=`) precisa alcançar o cartão de resgate — sem isto
  // ele fica instalado e inalcançável justamente para quem precisa dele.
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const houveErroSso = params.has('error');

  const [ajudaAberta, setAjudaAberta] = useState(params.has('ajuda') || houveErroSso);
  const [email, setEmail] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [mensagem, setMensagem] = useState<string | null>(null);

  const pedirAcesso = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setEnviando(true);
      try {
        await fetch(REQUEST_ACCESS_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, app_code: 'engage' }),
        });
      } catch {
        /* falha de rede não pode mudar a resposta — ver comentário do topo */
      }
      setMensagem(RESPOSTA_PADRAO);
      setEnviando(false);
    },
    [email],
  );

  return (
    <div className="min-h-screen bg-canvas">
      <VYDEcosystemBanner />

      <div className="flex min-h-[calc(100vh-40px)] items-center justify-center p-4">
        <div className="w-full max-w-md">
          <Link
            to="/"
            className="mb-6 inline-flex items-center gap-2 text-sm text-secondary hover:text-primary"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Voltar
          </Link>

          <div className="vyd-card p-8">
            <div className="mb-6 text-center">
              <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-action-primary/10">
                <Shield className="h-5 w-5 text-action-primary" aria-hidden="true" />
              </div>
              <h1 className="text-lg font-semibold text-primary">Acesso ao VYD Engage</h1>
              <p className="mt-1 text-sm text-secondary">
                O acesso é feito com sua conta VYD ID.
              </p>
            </div>

            {houveErroSso && (
              /* Mostra que falhou, sem ecoar o valor do parâmetro na tela. */
              <p className="mb-4 text-center text-sm text-destructive">
                Não foi possível entrar pelo VYD ID.
              </p>
            )}

            <Button asChild className="w-full">
              <a href={VYD_ID_URL}>Entrar com VYD ID</a>
            </Button>

            <div className="mt-4">
              {!ajudaAberta ? (
                <button
                  type="button"
                  onClick={() => setAjudaAberta(true)}
                  className="w-full text-xs text-secondary hover:text-primary hover:underline"
                >
                  Não consigo entrar
                </button>
              ) : mensagem ? (
                <p className="text-center text-sm text-secondary">{mensagem}</p>
              ) : (
                <form onSubmit={pedirAcesso} className="space-y-3">
                  <Label htmlFor="ajuda-email">Seu e-mail corporativo</Label>
                  <Input
                    id="ajuda-email"
                    type="email"
                    required
                    autoComplete="email"
                    placeholder="seu.email@k2mais.com.br"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                  <Button type="submit" variant="outline" className="w-full" disabled={enviando}>
                    {enviando ? 'Enviando...' : 'Solicitar acesso'}
                  </Button>
                </form>
              )}
            </div>
          </div>

          <p className="mt-6 text-center text-xs text-secondary">
            VYD Engage · CRM do ecossistema VYD
          </p>
        </div>
      </div>
    </div>
  );
}
