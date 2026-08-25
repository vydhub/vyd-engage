import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Transcrição genérica (specs/leads-oportunidade reqs. 44-46): normalização de
 * MIME (audio/webm;codecs=opus do Chrome), códigos de erro do serviço e
 * registro de uso — mesmo padrão de mocks do meetingService.test.ts.
 */

const transcribeMock = vi.fn();
vi.mock('ai', () => ({
  experimental_transcribe: (...args: unknown[]) => transcribeMock(...args),
}));
vi.mock('@ai-sdk/openai', () => ({
  createOpenAI: () => ({ transcription: () => 'whisper-model' }),
}));

const aiState: { enabled: boolean; provider: string | null; apiKey: string | null } = {
  enabled: true,
  provider: 'openai',
  apiKey: 'sk-test',
};
vi.mock('../../services/aiProvider.js', () => ({
  isAIEnabled: () => aiState.enabled,
  resolveProviderConfig: () =>
    aiState.provider ? { provider: aiState.provider, apiKey: aiState.apiKey } : null,
  logAiUsage: vi.fn().mockResolvedValue(undefined),
}));

import { logAiUsage } from '../../services/aiProvider.js';
import {
  transcriptionService,
  normalizeAudioMimeType,
} from '../../services/transcriptionService.js';

beforeEach(() => {
  vi.clearAllMocks();
  aiState.enabled = true;
  aiState.provider = 'openai';
  aiState.apiKey = 'sk-test';
  transcribeMock.mockResolvedValue({ text: 'texto transcrito da reunião' });
});

describe('normalizeAudioMimeType (req. 46)', () => {
  it("normaliza 'audio/webm;codecs=opus' (Chrome) para 'audio/webm'", () => {
    expect(normalizeAudioMimeType('audio/webm;codecs=opus')).toBe('audio/webm');
  });

  it('normaliza caixa e espaços em torno de parâmetros', () => {
    expect(normalizeAudioMimeType('AUDIO/MP4 ; codecs=mp4a.40.2')).toBe('audio/mp4');
  });

  it('MIME simples passa intacto', () => {
    expect(normalizeAudioMimeType('audio/mpeg')).toBe('audio/mpeg');
  });
});

describe('transcriptionService.transcribeAudio', () => {
  const buffer = Buffer.from('fake-audio-bytes');

  it('transcreve e registra uso com a feature informada', async () => {
    const text = await transcriptionService.transcribeAudio(
      'tenant-1',
      buffer,
      'audio/webm;codecs=opus',
      'field_transcription'
    );

    expect(text).toBe('texto transcrito da reunião');
    expect(transcribeMock).toHaveBeenCalledTimes(1);
    expect(logAiUsage).toHaveBeenCalledWith(
      expect.objectContaining({ feature: 'field_transcription' })
    );
  });

  it('MIME que não é áudio → 415 UNSUPPORTED_AUDIO_TYPE', async () => {
    await expect(
      transcriptionService.transcribeAudio('tenant-1', buffer, 'application/pdf')
    ).rejects.toMatchObject({ statusCode: 415, code: 'UNSUPPORTED_AUDIO_TYPE' });
    expect(transcribeMock).not.toHaveBeenCalled();
  });

  it('sem OpenAI configurada → 503 AI_NOT_CONFIGURED (degradação do req. 46)', async () => {
    aiState.provider = 'anthropic';
    aiState.apiKey = null;
    delete process.env.OPENAI_API_KEY;

    await expect(
      transcriptionService.transcribeAudio('tenant-1', buffer, 'audio/webm')
    ).rejects.toMatchObject({ statusCode: 503, code: 'AI_NOT_CONFIGURED' });
  });

  it('falha de runtime do provedor → 503 AI_PROVIDER_UNAVAILABLE (nunca 500)', async () => {
    transcribeMock.mockRejectedValueOnce(new Error('rede caiu'));

    await expect(
      transcriptionService.transcribeAudio('tenant-1', buffer, 'audio/webm')
    ).rejects.toMatchObject({ statusCode: 503, code: 'AI_PROVIDER_UNAVAILABLE' });
  });
});
