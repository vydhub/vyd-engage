/**
 * Rota que a pessoa tentou abrir sem sessão (spec captura-demandas, E-20). O login passa pelo
 * VYD ID, em outro domínio, e `state` do roteador não sobrevive à ida e volta. O `sessionStorage`
 * sobrevive, na mesma aba: um link aberto em outra aba durante o login não volta para cá.
 * O acesso é protegido porque pode falhar em janela privada ou com dados de site bloqueados, e o
 * login precisa seguir mesmo assim.
 */
export const CHAVE_DESTINO = 'vyd-engage:destino-apos-login';

export function guardarDestino(rota: string): void {
  try {
    sessionStorage.setItem(CHAVE_DESTINO, rota);
  } catch {
    // Sem armazenamento, a pessoa entra e cai em /app.
  }
}

export function lerDestino(): string | null {
  try {
    return sessionStorage.getItem(CHAVE_DESTINO);
  } catch {
    return null;
  }
}

export function limparDestino(): void {
  try {
    sessionStorage.removeItem(CHAVE_DESTINO);
  } catch {
    // Nada a limpar.
  }
}
