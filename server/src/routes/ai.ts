import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import multer from 'multer';
import { authenticate } from '../middleware/auth.js';
import { tenantScope } from '../middleware/tenant.js';
import { aiLimiter } from '../middleware/rateLimit.js';
import { createError } from '../middleware/errorHandler.js';
import { aiDraftService } from '../services/aiDraftService.js';
import { transcriptionService } from '../services/transcriptionService.js';
import { isAIEnabled, isTranscriptionEnabled } from '../services/aiProvider.js';

// Transcrição genérica de áudio (spec leads-oportunidade, req. 45): upload em
// memória (multipart, campo "audio"), limite de 25 MB — mesmo padrão da IA de
// reuniões (deals.ts). O texto transcrito alimenta campos como "Informações da
// oportunidade" e "Assuntos tratados"; nada é persistido aqui.
const TRANSCRIBE_AUDIO_MAX_BYTES = 25 * 1024 * 1024;
const transcribeUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: TRANSCRIBE_AUDIO_MAX_BYTES },
});
function handleTranscribeAudioUpload(req: Request, res: Response, next: NextFunction) {
  const mw = transcribeUpload.single('audio');
  mw(req, res, (err: unknown) => {
    if (err) {
      if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
        return next(createError('Áudio excede o tamanho máximo de 25 MB.', 413, 'FILE_TOO_LARGE'));
      }
      return next(createError('Falha no upload do áudio.', 400, 'UPLOAD_FAILED'));
    }
    next();
  });
}

const router = Router();

router.use(authenticate);
router.use(tenantScope);

// GET /api/ai/status — whether AI features are enabled (AI_PROVIDER configured).
// Frontend uses this to hide all AI features (spec req 33). Not an AI call, so
// it is intentionally NOT behind the AI rate limiter.
router.get('/status', async (req, res, next) => {
  try {
    if (!req.user) return next(createError('Authentication required', 401));
    res.json({
      status: 200,
      data: { enabled: isAIEnabled(), transcription: isTranscriptionEnabled() },
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/ai/transcribe — transcreve um áudio (Whisper) e devolve o texto puro.
// Usado pelos campos com entrada por áudio (req. 44-45). Erros: sem arquivo → 400
// AUDIO_REQUIRED; não-áudio → 415; > 25 MB → 413; sem OpenAI → 503; sem fala → 422.
router.post('/transcribe', aiLimiter, handleTranscribeAudioUpload, async (req, res, next) => {
  try {
    if (!req.user) return next(createError('Authentication required', 401));

    const file = req.file;
    if (!file) {
      return next(
        createError('Envie um arquivo de áudio (campo "audio").', 400, 'AUDIO_REQUIRED')
      );
    }

    // Arquivo presente mas sem conteúdo (0 bytes) → não há o que transcrever.
    if (!file.buffer || file.buffer.length === 0) {
      return next(
        createError(
          'Não foi possível transcrever o áudio (arquivo vazio).',
          422,
          'TRANSCRIPTION_EMPTY'
        )
      );
    }

    const text = (
      await transcriptionService.transcribeAudio(
        req.user.tenantId,
        file.buffer,
        file.mimetype,
        'field_transcription'
      )
    ).trim();

    // Áudio silencioso/sem fala detectada → 422 (caso extremo 8 da spec).
    if (!text) {
      return next(
        createError(
          'Não foi possível transcrever o áudio (sem fala detectada).',
          422,
          'TRANSCRIPTION_EMPTY'
        )
      );
    }

    res.json({ status: 200, data: { text } });
  } catch (error) {
    next(error);
  }
});

// ========================
// Email Draft Generation
// ========================

const generateDraftSchema = z.object({
  leadId: z.string().uuid().optional(),
  dealId: z.string().uuid().optional(),
  templateType: z.enum(['initial_outreach', 'follow_up', 'proposal', 'thank_you']),
  customInstructions: z.string().max(500).optional(),
});

// POST /api/ai/email-draft — Generate an email draft
router.post('/email-draft', async (req, res, next) => {
  try {
    if (!req.user) return next(createError('Authentication required', 401));

    const data = generateDraftSchema.parse(req.body);

    if (!data.leadId && !data.dealId) {
      return next(createError('leadId ou dealId é obrigatório', 400, 'VALIDATION_ERROR'));
    }

    const draft = await aiDraftService.generateEmailDraft(
      req.user.tenantId,
      req.user.userId,
      data.templateType,
      data.leadId,
      data.dealId,
      data.customInstructions
    );

    res.json({ status: 200, data: draft });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return next(createError('Validation error', 400, 'VALIDATION_ERROR', error.errors));
    }
    next(error);
  }
});

// GET /api/ai/templates — List available templates
router.get('/templates', async (req, res, next) => {
  try {
    if (!req.user) return next(createError('Authentication required', 401));

    const templates = aiDraftService.getTemplates();
    res.json({ status: 200, data: templates });
  } catch (error) {
    next(error);
  }
});

// GET /api/ai/config — Get AI configuration status
router.get('/config', async (req, res, next) => {
  try {
    if (!req.user) return next(createError('Authentication required', 401));

    const config = aiDraftService.getAIConfig();
    res.json({ status: 200, data: config });
  } catch (error) {
    next(error);
  }
});

// POST /api/ai/test-connection — Test AI provider connection
router.post('/test-connection', async (req, res, next) => {
  try {
    if (!req.user) return next(createError('Authentication required', 401));

    const result = await aiDraftService.testConnection();
    res.json({ status: 200, data: result });
  } catch (error) {
    next(error);
  }
});

export default router;
