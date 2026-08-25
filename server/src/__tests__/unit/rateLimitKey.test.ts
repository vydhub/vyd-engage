import { describe, it, expect } from 'vitest';
import type { Request } from 'express';
import { ipDoCliente, chaveDoLimiter } from '../../middleware/rateLimit.js';

/**
 * Chave do apiLimiter.
 *
 * O frontend fala com engage.vydhub.com e a Vercel proxia /api até aqui, então
 * o `req.ip` do Express é o IP da INFRAESTRUTURA — e `trust proxy` não resolve,
 * porque a Vercel não coloca o cliente no X-Forwarded-For. Sem esta função, o
 * balde de 100 req/15min é UM SÓ para o app inteiro.
 */
function reqFalso(headers: Record<string, string>, ip = '10.0.0.1'): Request {
  return {
    ip,
    get: (nome: string) => headers[nome.toLowerCase()],
  } as unknown as Request;
}

describe('ipDoCliente', () => {
  it('usa o IP real do usuário que a Vercel repassa', () => {
    const req = reqFalso({ 'x-vercel-forwarded-for': '186.248.207.190' }, '56.125.190.173');
    expect(ipDoCliente(req)).toBe('186.248.207.190');
  });

  it('NÃO usa o req.ip quando o header da Vercel existe — era esse o bug', () => {
    // 56.125.190.173 é um IP de edge: todos os usuários chegariam com ele e
    // dividiriam o mesmo balde.
    const req = reqFalso({ 'x-vercel-forwarded-for': '186.248.207.190' }, '56.125.190.173');
    expect(ipDoCliente(req)).not.toBe('56.125.190.173');
  });

  it('pega só o primeiro quando vem uma lista', () => {
    const req = reqFalso({ 'x-vercel-forwarded-for': '186.248.207.190, 10.1.1.1' });
    expect(ipDoCliente(req)).toBe('186.248.207.190');
  });

  it('cai no req.ip sem o header (dev local, chamada direta ao Railway)', () => {
    expect(ipDoCliente(reqFalso({}, '203.0.113.7'))).toBe('203.0.113.7');
  });

  it('nunca devolve vazio', () => {
    const req = { ip: undefined, get: () => undefined } as unknown as Request;
    expect(ipDoCliente(req)).toBe('anonymous');
  });
});

/**
 * Chave do apiLimiter: sessão quando existe, IP quando não existe.
 *
 * Numa empresa todo mundo sai pelo mesmo IP público (NAT). Com chave por IP os
 * usuários do tenant dividem UM balde — foi o que devolveu 429 ao salvar lead.
 */
function reqComCookies(
  cookies: Record<string, string>,
  headers: Record<string, string> = {},
  ip = '10.0.0.1'
): Request {
  return {
    ip,
    cookies,
    get: (nome: string) => headers[nome.toLowerCase()],
  } as unknown as Request;
}

describe('chaveDoLimiter', () => {
  const MESMO_IP = { 'x-vercel-forwarded-for': '186.248.207.190' };

  it('dois usuários no MESMO IP recebem baldes distintos (o bug do 429)', () => {
    const ricardo = chaveDoLimiter(reqComCookies({ accessToken: 'token-do-ricardo' }, MESMO_IP));
    const kleber = chaveDoLimiter(reqComCookies({ accessToken: 'token-do-kleber' }, MESMO_IP));
    expect(ricardo).not.toBe(kleber);
  });

  it('a mesma sessão mantém a mesma chave entre requisições', () => {
    const a = chaveDoLimiter(reqComCookies({ accessToken: 'tk' }, MESMO_IP));
    const b = chaveDoLimiter(reqComCookies({ accessToken: 'tk' }, { ...MESMO_IP }, '10.9.9.9'));
    expect(a).toBe(b);
  });

  it('sem cookie cai no IP do cliente (rota pública, captura de lead)', () => {
    expect(chaveDoLimiter(reqComCookies({}, MESMO_IP))).toBe('ip:186.248.207.190');
  });

  it('não guarda o token em claro na chave', () => {
    const chave = chaveDoLimiter(reqComCookies({ accessToken: 'segredo-do-usuario' }, MESMO_IP));
    expect(chave).not.toContain('segredo-do-usuario');
    expect(chave.startsWith('s:')).toBe(true);
  });

  it('nunca devolve vazio', () => {
    const req = { ip: undefined, cookies: undefined, get: () => undefined } as unknown as Request;
    expect(chaveDoLimiter(req)).toBe('ip:anonymous');
  });
});
