/*
 * Handoff do VYD ID: o token tem de voltar à origem de onde o login saiu.
 *
 * O botão "Entrar com VYD ID" ia para a raiz do portal, e o portal devolvia o
 * token sempre em https://engage.vydhub.com — num preview da Vercel a pessoa
 * terminava em produção, sem sessão no preview (04/11/2026, FRG-175). O Desk
 * teve o mesmo defeito e a mesma correção (vyd-desk, src/lib/vydId.ts).
 *
 * O portal só aceita `redirect_to` presente em `apps.allowed_redirect_urls` do
 * app `engage` no IdP — os previews entram lá por curinga. A rota que a pessoa
 * tentou abrir sem sessão não vai na URL: fica no sessionStorage
 * (utils/destinoAposLogin) e o /sso a lê na volta.
 */
export const VYD_ID_PORTAL_URL = 'https://id.vydhub.com';
export const VYD_ID_APP_CODE = 'engage';

export function vydIdHandoffUrl(origin: string = window.location.origin): string {
  return `${VYD_ID_PORTAL_URL}/handoff/${VYD_ID_APP_CODE}?redirect_to=${encodeURIComponent(`${origin}/`)}`;
}
