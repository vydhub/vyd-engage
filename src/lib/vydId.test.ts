import { describe, expect, it } from 'vitest';
import { VYD_ID_APP_CODE, VYD_ID_PORTAL_URL, vydIdHandoffUrl } from './vydId';

/**
 * Handoff do VYD ID — o token volta para a origem de onde o login saiu.
 * Antes o botão ia para a raiz do portal e o token caía sempre em
 * https://engage.vydhub.com: quem testava um preview terminava em produção.
 */
const PREVIEW = 'https://vyd-engage-9cn3htmg9-klebers-projects-2f5727d9.vercel.app';

const redirectTo = (url: string) => new URL(url).searchParams.get('redirect_to');

describe('vydIdHandoffUrl', () => {
  it('vai ao handoff do Engage no portal, não à raiz', () => {
    const url = new URL(vydIdHandoffUrl(PREVIEW));
    expect(`${url.origin}${url.pathname}`).toBe(`${VYD_ID_PORTAL_URL}/handoff/${VYD_ID_APP_CODE}`);
  });

  it('devolve o token à origem do preview, não à de produção', () => {
    expect(redirectTo(vydIdHandoffUrl(PREVIEW))).toBe(`${PREVIEW}/`);
  });

  it('em produção a origem é a de sempre', () => {
    expect(redirectTo(vydIdHandoffUrl('https://engage.vydhub.com'))).toBe('https://engage.vydhub.com/');
  });

  it('sem argumento usa a origem da página aberta', () => {
    expect(redirectTo(vydIdHandoffUrl())).toBe(`${window.location.origin}/`);
  });
});
