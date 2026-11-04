import { useEffect, useRef, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import { apiClient } from '../services/api/client';

// Mesma base da API (apiClient): VITE_API_URL quando definida, senão a própria
// origem da página, e localhost:3001 em dev. Em produção VITE_API_URL é a
// PRÓPRIA origem do frontend (https://engage.vydhub.com); nos previews da Vercel
// ela não existe e vale a origem do preview. Isso é intencional: o vercel.json
// proxia /api e /socket.io até o Railway, mantendo tudo same-origin — é o que
// faz o cookie httpOnly `accessToken` chegar ao handshake
// (server/src/services/socketService.ts). NÃO troque para a URL do Railway: os
// cookies são host-only (sem `domain`, em server/src/utils/cookies.ts), o
// browser não os enviaria para outro host e o handshake seria recusado. Pior, o
// CSRF é double-submit lido de document.cookie (src/services/api/client.ts) e
// toda escrita do app passaria a dar 403.
const SOCKET_URL = apiClient.getApiUrl();

let sharedSocket: Socket | null = null;
let refCount = 0;
let rearmeInstalado = false;

/**
 * Reconecta quando há chance real de sucesso. Necessário porque limitamos as
 * tentativas abaixo: sem isto, quem ficasse alguns minutos sem rede não
 * receberia mais nenhum evento até recarregar a página. O manager zera o
 * backoff ao desistir, então um connect() posterior recebe orçamento novo.
 */
function instalarRearme(): void {
  if (rearmeInstalado || typeof window === 'undefined') return;
  rearmeInstalado = true;

  const rearmar = () => {
    if (refCount > 0 && sharedSocket && !sharedSocket.connected) {
      sharedSocket.connect();
    }
  };

  window.addEventListener('online', rearmar);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') rearmar();
  });
}

function getOrCreateSocket(): Socket {
  // A condição de recriação NÃO pode olhar `disconnected`: em socket.io-client
  // `disconnected` é só `!connected`, e um socket recém-criado fica
  // `connected === false` durante TODA a conexão inicial. Como vários
  // consumidores montam no mesmo tick (NotificationContext, useLeads, useTasks,
  // AutomationLogs), a versão anterior criava de 2 a 4 sockets por aba e
  // abandonava os anteriores — que seguiam conectados e contando como tráfego.
  // Só criamos quando não há instância; quem zera a referência é o teardown.
  if (!sharedSocket) {
    sharedSocket = io(SOCKET_URL, {
      withCredentials: true, // envia o cookie httpOnly accessToken no handshake

      // Polling PRIMEIRO, e isto não é preferência estética: a opção
      // `tryAllTransports` não está nos defaults do engine.io-client, e é dela
      // que depende a queda de um transporte para o outro. Com
      // ['websocket','polling'] uma falha de websocket NUNCA tentava polling —
      // apenas reconectava do zero. Com polling primeiro a conexão se
      // estabelece por HTTP e o upgrade para websocket vem por cima, de graça,
      // quando o caminho suportar.
      transports: ['polling', 'websocket'],
      autoConnect: true,

      // Contenção. Os defaults são Infinity / 1000ms / 5000ms — foi assim que
      // um /socket.io respondendo HTML (o catch-all do vercel.json, antes do
      // rewrite) virou um loop de reconexão permanente por aba, volumoso o
      // bastante para a Vercel tratar o tráfego como robótico e passar a
      // desafiar o domínio com 403. Agora desiste em ~3 min e espera o rearme.
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 30000,
    });

    // Torna a próxima falha diagnosticável em vez de silenciosa.
    sharedSocket.on('connect_error', (erro) => {
      console.warn('[socket] connect_error:', erro.message);
    });
  }
  return sharedSocket;
}

/**
 * Hook to connect to the WebSocket server and listen for events.
 * Uses a shared socket instance across the app. Auth via httpOnly cookie.
 */
export function useSocket(enabled: boolean = true) {
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    if (!enabled) return;

    const socket = getOrCreateSocket();
    socketRef.current = socket;
    refCount++;
    instalarRearme();

    if (!socket.connected) {
      socket.connect();
    }

    return () => {
      refCount--;
      if (refCount <= 0 && sharedSocket) {
        sharedSocket.disconnect();
        sharedSocket = null;
        refCount = 0;
      }
    };
  }, [enabled]);

  const on = useCallback((event: string, handler: (...args: unknown[]) => void) => {
    const socket = socketRef.current;
    if (!socket) return () => {};
    socket.on(event, handler);
    return () => {
      socket.off(event, handler);
    };
  }, []);

  return { socket: socketRef.current, on };
}
