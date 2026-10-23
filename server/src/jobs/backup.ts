import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { logger } from '../utils/logger.js';
import { captureException } from '../utils/sentry.js';

const execAsync = promisify(exec);

const MAX_LOCAL_BACKUPS = 7;

function parseDatabaseUrl(url: string) {
  try {
    const u = new URL(url);
    return {
      host: u.hostname,
      port: u.port || '5432',
      // URL() entrega componentes percent-encoded; decodifica para o pg_dump
      // (senha com caractere especial vinha errada no PGPASSWORD).
      database: decodeURIComponent(u.pathname.slice(1)),
      user: decodeURIComponent(u.username),
      password: decodeURIComponent(u.password),
    };
  } catch {
    return null;
  }
}

export async function runBackup(): Promise<void> {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    logger.warn('Backup skipped: DATABASE_URL not set');
    return;
  }

  const db = parseDatabaseUrl(dbUrl);
  if (!db) {
    logger.error('Backup failed: cannot parse DATABASE_URL');
    return;
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  // Formato custom do pg_dump (-Fc): já comprimido, restaurável com pg_restore
  // (inclusive seletivo/paralelo). Elimina o pipe `| gzip` antigo, cujo exit
  // code era o do gzip — pg_dump podia falhar (binário ausente, versão
  // incompatível) e o job logava "backup created" com arquivo VAZIO (0.00MB),
  // como ocorreu em produção até 01/08/2026.
  const filename = `backup-${timestamp}.dump`;
  const backupDir = process.env.BACKUP_DIR || '/tmp/vyd-backups';
  const backupPath = path.join(backupDir, filename);

  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  const env = { ...process.env, PGPASSWORD: db.password };
  // -w (--no-password): nunca esperar senha em stdin; timeout mata um pg_dump
  // pendurado (senão o setTimeout de agendamento nunca é rearmado e o job
  // morre em silêncio para sempre).
  const cmd = `pg_dump -Fc -w -h ${db.host} -p ${db.port} -U ${db.user} -d ${db.database} -f "${backupPath}"`;

  try {
    await execAsync(cmd, { env, maxBuffer: 16 * 1024 * 1024, timeout: 15 * 60_000 });
  } catch (err: any) {
    const detail = { error: err.message, stderr: String(err.stderr || '').slice(-500) };
    logger.error(
      '🚨 BACKUP FALHOU — produção está SEM backup até isto ser corrigido (verifique se o pg_dump existe no container e se a versão é >= à do servidor)',
      detail
    );
    captureException(err instanceof Error ? err : new Error(String(err)), {
      job: 'backup',
      stage: 'pg_dump',
      ...detail,
    });
    if (fs.existsSync(backupPath)) fs.unlinkSync(backupPath);
    return;
  }

  // Um dump real deste banco tem centenas de KB+; bem menos que isso é falha
  // disfarçada. Mantém o arquivo para diagnóstico (não apaga: um dump pequeno
  // porém válido ainda é melhor que backup nenhum).
  const MIN_BACKUP_BYTES = 10_000;
  const stat = fs.statSync(backupPath);
  if (stat.size < MIN_BACKUP_BYTES) {
    const msg = `Backup suspeito de vazio (${stat.size} bytes) — investigar pg_dump no container`;
    logger.error(`🚨 ${msg}`, { file: filename });
    captureException(new Error(msg), { job: 'backup', stage: 'size-check', file: filename });
    return;
  }

  logger.info('Database backup created', {
    file: filename,
    size: `${(stat.size / 1024 / 1024).toFixed(2)}MB`,
  });

  // Cópia fora do Railway (opcional): o volume do backup mora no mesmo Railway
  // do banco, então perder o projeto levaria banco e backups juntos. As cópias
  // locais continuam (restauração rápida); o bucket é a que sobrevive a isso.
  const s3Bucket = process.env.BACKUP_S3_BUCKET;
  if (s3Bucket) {
    try {
      const key = await uploadToS3(backupPath, s3Bucket, filename);
      logger.info('Backup uploaded to S3', { bucket: s3Bucket, key });
    } catch (err: any) {
      logger.error('🚨 Envio do backup para o bucket FALHOU — só a cópia local existe', {
        error: err.message,
      });
      captureException(err instanceof Error ? err : new Error(String(err)), {
        job: 'backup',
        stage: 's3-upload',
        bucket: s3Bucket,
      });
    }
  }

  pruneOldBackups(backupDir);
}

/**
 * Envia o dump para um bucket S3-compatível (AWS S3, Cloudflare R2, Backblaze
 * B2, MinIO) pelo SDK — o container não tem a CLI `aws`. Configuração por env:
 *
 *   BACKUP_S3_BUCKET              (liga o envio)
 *   BACKUP_S3_ACCESS_KEY_ID       (obrigatório)
 *   BACKUP_S3_SECRET_ACCESS_KEY   (obrigatório)
 *   BACKUP_S3_ENDPOINT            (R2/B2/MinIO; ausente = AWS)
 *   BACKUP_S3_REGION              (default "auto" com endpoint, "us-east-1" sem)
 *   BACKUP_S3_FORCE_PATH_STYLE    ("true" p/ MinIO e afins)
 *
 * Chaves e bucket próprios, separados dos anexos (STORAGE_S3_*): quem vazar a
 * chave dos anexos não alcança os backups. A retenção no bucket fica com a
 * regra de ciclo de vida do próprio bucket.
 */
async function uploadToS3(localPath: string, bucket: string, filename: string): Promise<string> {
  const accessKeyId = process.env.BACKUP_S3_ACCESS_KEY_ID;
  const secretAccessKey = process.env.BACKUP_S3_SECRET_ACCESS_KEY;
  if (!accessKeyId || !secretAccessKey) {
    throw new Error('BACKUP_S3_ACCESS_KEY_ID e BACKUP_S3_SECRET_ACCESS_KEY são obrigatórias para enviar o backup');
  }

  const endpoint = process.env.BACKUP_S3_ENDPOINT || undefined;
  const client = new S3Client({
    region: process.env.BACKUP_S3_REGION || (endpoint ? 'auto' : 'us-east-1'),
    ...(endpoint ? { endpoint } : {}),
    forcePathStyle: process.env.BACKUP_S3_FORCE_PATH_STYLE === 'true',
    credentials: { accessKeyId, secretAccessKey },
    // Corpo em stream: sem isto o SDK manda checksum em trailer (aws-chunked),
    // que R2/B2/MinIO recusam. A integridade é conferida pelo tamanho abaixo.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });

  const key = `database-backups/${filename}`;
  const size = fs.statSync(localPath).size;
  // Mesmo teto do pg_dump: um envio pendurado não pode segurar o reagendamento.
  const abortSignal = AbortSignal.timeout(15 * 60_000);
  try {
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: fs.createReadStream(localPath),
        ContentLength: size,
        ContentType: 'application/octet-stream',
      }),
      { abortSignal }
    );
    const head = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }), {
      abortSignal,
    });
    if (head.ContentLength !== size) {
      throw new Error(`Objeto no bucket com ${head.ContentLength} bytes; o dump local tem ${size}`);
    }
  } finally {
    client.destroy();
  }
  return key;
}

function pruneOldBackups(dir: string): void {
  try {
    const files = fs
      .readdirSync(dir)
      .filter((f) => f.startsWith('backup-') && (f.endsWith('.sql.gz') || f.endsWith('.dump')))
      .map((f) => ({ name: f, time: fs.statSync(path.join(dir, f)).mtimeMs }))
      .sort((a, b) => b.time - a.time);

    files.slice(MAX_LOCAL_BACKUPS).forEach((f) => {
      fs.unlinkSync(path.join(dir, f.name));
      logger.info('Old backup pruned', { file: f.name });
    });
  } catch (err: any) {
    logger.warn('Failed to prune old backups', { error: err.message });
  }
}

// Hora (UTC) da execução diária. Default 6 = 03:00 em Brasília. O pg_dump|gzip
// roda NESTE container e compete por CPU com a API — agendado por relógio de
// parede, de madrugada, e não "a cada 24h desde o boot" (que caía em horário
// comercial e congelava a UI p/ todos os usuários — incidente 29/07/2026).
const BACKUP_UTC_HOUR = parseInt(process.env.BACKUP_UTC_HOUR || '6', 10);

function msUntilNextRun(utcHour: number): number {
  const now = new Date();
  const next = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), utcHour, 0, 0, 0)
  );
  if (next.getTime() <= now.getTime()) next.setUTCDate(next.getUTCDate() + 1);
  return next.getTime() - now.getTime();
}

export async function initializeBackupJob(): Promise<void> {
  const scheduleNext = () => {
    const delay = msUntilNextRun(BACKUP_UTC_HOUR);
    setTimeout(() => {
      runBackup()
        .catch((err) => logger.error('Backup job error', err))
        .finally(scheduleNext);
    }, delay);
    logger.info('Backup job scheduled', {
      utcHour: BACKUP_UTC_HOUR,
      nextRunInHours: (delay / 3_600_000).toFixed(1),
    });
  };
  scheduleNext();
}
