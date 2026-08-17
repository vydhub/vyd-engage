/**
 * transcriptionService — transcrição de áudio compartilhada (Whisper/OpenAI).
 *
 * Extraído do meetingService (Upgrade RD P3) para servir também os campos de
 * texto com entrada por áudio (spec leads-oportunidade, reqs. 44-46):
 *  - `POST /api/v1/ai/transcribe` → feature `field_transcription` (default);
 *  - reuniões de Deal → meetingService delega com feature `meeting_transcription`.
 *
 * Garantias (mesmo contrato do comportamento original — sem regressão):
 *  - IA desabilitada (isAIEnabled=false) → 503 AI_NOT_CONFIGURED (nunca 500);
 *  - MIME não-áudio → 415 UNSUPPORTED_AUDIO_TYPE;
 *  - sem chave OpenAI (Whisper é exclusivo da OpenAI) → 503 AI_NOT_CONFIGURED;
 *  - falha de runtime do provedor (timeout/429/rede) → 503 AI_PROVIDER_UNAVAILABLE;
 *  - uso registrado via logAiUsage({ feature }) — só metadados, nunca conteúdo.
 *
 * Normalização de MIME (req. 46): o MediaRecorder do Chrome produz
 * `audio/webm;codecs=opus` — os parâmetros após `;` são removidos antes da
 * validação/registro, tratando como `audio/webm`.
 */
import { experimental_transcribe as transcribe } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { createError } from '../middleware/errorHandler.js';
import { logger } from '../utils/logger.js';
import { resolveProviderConfig, isAIEnabled, logAiUsage } from './aiProvider.js';

const AUDIO_MIME_PREFIX = 'audio/';

/**
 * Remove os parâmetros do MIME type (`audio/webm;codecs=opus` → `audio/webm`),
 * normalizando também caixa e espaços, antes de validar contra o prefixo `audio/`.
 */
export function normalizeAudioMimeType(mimeType: string): string {
  return mimeType.split(';')[0].trim().toLowerCase();
}

export const transcriptionService = {
  /**
   * Transcreve um áudio via Whisper (OpenAI) e retorna o texto. `feature`
   * identifica o chamador no logAiUsage (`field_transcription` por padrão;
   * `meeting_transcription` quando delegado pelo meetingService).
   */
  async transcribeAudio(
    tenantId: string,
    buffer: Buffer,
    mimeType: string,
    feature: string = 'field_transcription'
  ): Promise<string> {
    // Gating gracioso: sem provedor de IA algum → 503 AI_NOT_CONFIGURED (nunca 500).
    if (!isAIEnabled()) {
      throw createError(
        'Recurso de IA não configurado. Configure um provedor de IA para usar a transcrição.',
        503,
        'AI_NOT_CONFIGURED'
      );
    }

    // Normaliza ANTES de validar (req. 46): `audio/webm;codecs=opus` → `audio/webm`.
    const normalizedMime = normalizeAudioMimeType(mimeType);
    if (!normalizedMime.startsWith(AUDIO_MIME_PREFIX)) {
      throw createError(
        `Tipo de arquivo de áudio não suportado: ${mimeType}.`,
        415,
        'UNSUPPORTED_AUDIO_TYPE'
      );
    }

    // Whisper é específico da OpenAI. Só transcrevemos se houver uma API key OpenAI —
    // seja via AI_PROVIDER=openai, seja via OPENAI_API_KEY legado.
    const config = resolveProviderConfig();
    const openaiApiKey =
      config?.provider === 'openai' ? config.apiKey : process.env.OPENAI_API_KEY;
    if (!openaiApiKey) {
      throw createError(
        'Transcrição de áudio exige o provedor OpenAI (Whisper). Digite o texto manualmente ou configure a OpenAI.',
        503,
        'AI_NOT_CONFIGURED'
      );
    }

    const started = Date.now();
    const openai = createOpenAI({ apiKey: openaiApiKey });
    // A inferência genérica do transcribe pode disparar TS2589 sob node16 —
    // chamamos sem tipar e validamos o formato do retorno em runtime.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let result: any;
    try {
      // Uma falha de runtime do provedor (timeout, 429, rede, credencial revogada
      // mid-flight) sobe como erro cru SEM statusCode → viraria 500. Convertemos em
      // 503 AI_PROVIDER_UNAVAILABLE — "NUNCA 500 no caminho de IA".
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      result = await (transcribe as any)({
        model: openai.transcription('whisper-1'),
        audio: new Uint8Array(buffer),
      });
    } catch (err: unknown) {
      logger.warn('Falha na transcrição de áudio (IA).', err as Error);
      throw createError(
        'O serviço de transcrição está temporariamente indisponível. Tente novamente em instantes.',
        503,
        'AI_PROVIDER_UNAVAILABLE'
      );
    }
    logAiUsage({
      feature,
      tenantId,
      latencyMs: Date.now() - started,
      provider: 'openai',
    });
    return String(result?.text ?? '');
  },
};
