import { useEffect, useRef, useState } from 'react';
import { Mic, Square, Upload, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { apiClient } from '../services/api/client';
import { useAIStatus } from '../hooks/useAIStatus';

/**
 * Entrada por áudio para campos de texto (specs/leads-oportunidade req. 44-46):
 * grava no navegador (MediaRecorder) OU envia um arquivo de áudio; transcreve
 * via POST /api/v1/ai/transcribe (Whisper) e devolve o texto pelo callback.
 *
 * - Só renderiza quando a transcrição está disponível (useAIStatus().transcription);
 *   sem OpenAI o campo continua funcionando apenas com digitação (req. 46).
 * - Limite de gravação: 10 min (caso extremo 9, respeita o teto de 25 MB).
 * - Erros tratados sem perder o texto já digitado (caso extremo 8): microfone
 *   negado → instrução + upload continua; 503/422/413 → toast claro.
 */

const MAX_RECORDING_MS = 10 * 60 * 1000; // 10 min
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024; // 25 MB (mesmo teto do backend)

interface AudioTranscribeButtonProps {
  /** Recebe o texto transcrito — o chamador decide como inserir no campo. */
  onTranscribed: (text: string) => void;
  disabled?: boolean;
  className?: string;
}

export function AudioTranscribeButton({
  onTranscribed,
  disabled,
  className,
}: AudioTranscribeButtonProps) {
  const { transcription } = useAIStatus();
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedAtRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    return () => {
      // Desmontou gravando: para o recorder e libera o microfone
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
        mediaRecorderRef.current.stream.getTracks().forEach((t) => t.stop());
      }
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  // Gating (req. 46): sem transcrição disponível, nada é renderizado
  if (!transcription) return null;

  const transcribe = async (blob: Blob, fileName: string) => {
    if (blob.size === 0) {
      toast.error('Gravação vazia — tente novamente.');
      return;
    }
    if (blob.size > MAX_UPLOAD_BYTES) {
      toast.error('Áudio maior que 25 MB — grave um trecho mais curto.');
      return;
    }
    setTranscribing(true);
    try {
      const { text } = await apiClient.transcribeAudio(blob, fileName);
      if (text?.trim()) {
        onTranscribed(text.trim());
        toast.success('Áudio transcrito.');
      } else {
        toast.error('Não foi possível transcrever o áudio (sem fala detectada).');
      }
    } catch (err: unknown) {
      const message =
        err instanceof Error && err.message
          ? err.message
          : 'Falha na transcrição — o texto digitado foi preservado.';
      toast.error(message);
    } finally {
      setTranscribing(false);
    }
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const mimeType = recorder.mimeType || 'audio/webm';
        const blob = new Blob(chunksRef.current, { type: mimeType });
        const ext = mimeType.includes('ogg') ? 'ogg' : mimeType.includes('mp4') ? 'm4a' : 'webm';
        void transcribe(blob, `gravacao.${ext}`);
      };
      recorder.start();
      mediaRecorderRef.current = recorder;
      startedAtRef.current = Date.now();
      setElapsed(0);
      setRecording(true);
      timerRef.current = setInterval(() => {
        const ms = Date.now() - startedAtRef.current;
        setElapsed(ms);
        if (ms >= MAX_RECORDING_MS) {
          toast.info('Limite de 10 minutos atingido — transcrevendo.');
          stopRecording();
        }
      }, 500);
    } catch {
      toast.error(
        'Microfone indisponível ou permissão negada. Você ainda pode enviar um arquivo de áudio.'
      );
    }
  };

  const stopRecording = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setRecording(false);
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== 'inactive') recorder.stop();
    mediaRecorderRef.current = null;
  };

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    void transcribe(file, file.name);
  };

  const fmt = (ms: number) => {
    const s = Math.floor(ms / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };

  return (
    <div className={`inline-flex items-center gap-1 ${className ?? ''}`}>
      {recording ? (
        <button
          type="button"
          onClick={stopRecording}
          className="inline-flex items-center gap-1 px-2 py-1 rounded border text-xs bg-red-50 text-red-600 border-red-200"
          title="Parar gravação e transcrever"
        >
          <Square size={12} aria-hidden="true" />
          Parar ({fmt(elapsed)})
        </button>
      ) : (
        <button
          type="button"
          onClick={startRecording}
          disabled={disabled || transcribing}
          className="inline-flex items-center gap-1 px-2 py-1 rounded border text-xs bg-gray-50 text-gray-600 border-gray-200 disabled:opacity-50"
          title="Gravar áudio e transcrever para o campo"
        >
          <Mic size={12} aria-hidden="true" />
          Gravar
        </button>
      )}
      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        disabled={disabled || recording || transcribing}
        className="inline-flex items-center gap-1 px-2 py-1 rounded border text-xs bg-gray-50 text-gray-600 border-gray-200 disabled:opacity-50"
        title="Enviar arquivo de áudio e transcrever para o campo"
      >
        {transcribing ? (
          <Loader2 size={12} className="animate-spin" aria-hidden="true" />
        ) : (
          <Upload size={12} aria-hidden="true" />
        )}
        {transcribing ? 'Transcrevendo…' : 'Áudio'}
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept="audio/*"
        className="hidden"
        onChange={handleFile}
      />
    </div>
  );
}
