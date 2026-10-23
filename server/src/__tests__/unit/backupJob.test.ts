import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

/**
 * Backup diário — cópia fora do Railway (BACKUP_S3_*).
 *
 * Prova que o envio usa o SDK (o container não tem a CLI `aws`), manda o dump
 * inteiro, confere o tamanho no bucket e nunca apaga a cópia local. O pg_dump e
 * o SDK S3 são MOCKADOS (sem banco, sem conta, sem rede): o pg_dump falso grava
 * um dump de 20 KB no caminho do `-f`.
 */
type Comando = { kind: 'put' | 'head'; input: Record<string, unknown> };

const h = vi.hoisted(() => ({
  configs: [] as Record<string, unknown>[],
  send: vi.fn(),
  destroyed: 0,
  uploaded: 0,
  captureException: vi.fn(),
}));

vi.mock('../../utils/logger.js', () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));
vi.mock('../../utils/sentry.js', () => ({ captureException: h.captureException }));
vi.mock('child_process', async () => {
  const { writeFileSync } = await import('fs');
  return {
    exec: (cmd: string, _opts: unknown, cb: (err: Error | null, out: unknown) => void) => {
      const destino = /-f "([^"]+)"/.exec(cmd)?.[1] as string;
      writeFileSync(destino, Buffer.alloc(20_000, 7));
      cb(null, { stdout: '', stderr: '' });
    },
  };
});
vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: class {
    constructor(config: Record<string, unknown>) {
      h.configs.push(config);
    }
    send(cmd: unknown, opts: unknown) {
      return h.send(cmd, opts);
    }
    destroy() {
      h.destroyed++;
    }
  },
  PutObjectCommand: class {
    kind = 'put';
    constructor(readonly input: Record<string, unknown>) {}
  },
  HeadObjectCommand: class {
    kind = 'head';
    constructor(readonly input: Record<string, unknown>) {}
  },
}));

import { runBackup } from '../../jobs/backup.js';

const ENV_KEYS = [
  'DATABASE_URL',
  'BACKUP_DIR',
  'BACKUP_S3_BUCKET',
  'BACKUP_S3_ENDPOINT',
  'BACKUP_S3_REGION',
  'BACKUP_S3_ACCESS_KEY_ID',
  'BACKUP_S3_SECRET_ACCESS_KEY',
  'BACKUP_S3_FORCE_PATH_STYLE',
] as const;
const envOriginal: Record<string, string | undefined> = {};
let dir: string;

const dumps = () => fs.readdirSync(dir).filter((f) => f.endsWith('.dump'));
const comandos = () => h.send.mock.calls.map((c) => c[0] as Comando);

function comBucket(extra: Record<string, string> = {}) {
  Object.assign(process.env, {
    BACKUP_S3_BUCKET: 'vyd-engage-backups',
    BACKUP_S3_ACCESS_KEY_ID: 'chave-teste',
    BACKUP_S3_SECRET_ACCESS_KEY: 'segredo-teste',
    ...extra,
  });
}

beforeEach(() => {
  for (const k of ENV_KEYS) {
    envOriginal[k] = process.env[k];
    delete process.env[k];
  }
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vyd-backup-'));
  process.env.DATABASE_URL = 'postgresql://u:p@localhost:5432/engage';
  process.env.BACKUP_DIR = dir;

  h.configs.length = 0;
  h.destroyed = 0;
  h.uploaded = 0;
  h.captureException.mockReset();
  h.send.mockReset();
  h.send.mockImplementation(async (cmd: Comando) => {
    if (cmd.kind === 'put') {
      let total = 0;
      for await (const pedaco of cmd.input.Body as AsyncIterable<Buffer>) total += pedaco.length;
      h.uploaded = total;
      return {};
    }
    return { ContentLength: h.uploaded };
  });
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (envOriginal[k] === undefined) delete process.env[k];
    else process.env[k] = envOriginal[k];
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('backup diário — cópia fora do Railway', () => {
  it('sem BACKUP_S3_BUCKET: só a cópia local, nenhum cliente S3', async () => {
    await runBackup();

    expect(dumps()).toHaveLength(1);
    expect(h.configs).toHaveLength(0);
    expect(h.send).not.toHaveBeenCalled();
    expect(h.captureException).not.toHaveBeenCalled();
  });

  it('com bucket e chaves (R2): envia o dump inteiro pelo SDK, confere o tamanho e mantém a cópia local', async () => {
    comBucket({ BACKUP_S3_ENDPOINT: 'https://conta.r2.cloudflarestorage.com' });

    await runBackup();

    expect(h.configs[0]).toMatchObject({
      region: 'auto',
      endpoint: 'https://conta.r2.cloudflarestorage.com',
      forcePathStyle: false,
      credentials: { accessKeyId: 'chave-teste', secretAccessKey: 'segredo-teste' },
      requestChecksumCalculation: 'WHEN_REQUIRED',
    });
    const [put, head] = comandos();
    expect(put.kind).toBe('put');
    expect(put.input).toMatchObject({ Bucket: 'vyd-engage-backups', ContentLength: 20_000 });
    expect(put.input.Key).toMatch(/^database-backups\/backup-.+\.dump$/);
    expect(h.uploaded).toBe(20_000);
    expect(head).toMatchObject({ kind: 'head', input: { Bucket: 'vyd-engage-backups', Key: put.input.Key } });
    expect(h.destroyed).toBe(1);
    expect(h.captureException).not.toHaveBeenCalled();
    // A cópia local não é apagada depois do envio.
    expect(dumps()).toEqual([String(put.input.Key).replace('database-backups/', '')]);
  });

  it('sem endpoint (AWS S3): região padrão us-east-1 e nenhum endpoint', async () => {
    comBucket();

    await runBackup();

    expect(h.configs[0].region).toBe('us-east-1');
    expect(h.configs[0]).not.toHaveProperty('endpoint');
  });

  it('tamanho no bucket diferente do dump: avisa no Sentry e mantém a cópia local', async () => {
    comBucket();
    h.send.mockImplementation(async (cmd: Comando) => {
      if (cmd.kind === 'put') {
        for await (const _ of cmd.input.Body as AsyncIterable<Buffer>) void _;
        return {};
      }
      return { ContentLength: 10 };
    });

    await runBackup();

    expect(h.captureException).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('10 bytes') }),
      expect.objectContaining({ job: 'backup', stage: 's3-upload', bucket: 'vyd-engage-backups' })
    );
    expect(h.destroyed).toBe(1);
    expect(dumps()).toHaveLength(1);
  });

  it('bucket sem chaves: avisa no Sentry e não tenta enviar', async () => {
    process.env.BACKUP_S3_BUCKET = 'vyd-engage-backups';

    await runBackup();

    expect(h.send).not.toHaveBeenCalled();
    expect(h.captureException).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('BACKUP_S3_ACCESS_KEY_ID') }),
      expect.objectContaining({ stage: 's3-upload' })
    );
    expect(dumps()).toHaveLength(1);
  });

  it('poda as cópias locais para as 7 mais novas também quando envia', async () => {
    comBucket();
    const antigo = Date.now() / 1000 - 86_400;
    for (let i = 0; i < 8; i++) {
      const f = path.join(dir, `backup-antigo-${i}.dump`);
      fs.writeFileSync(f, 'x');
      fs.utimesSync(f, antigo - i * 86_400, antigo - i * 86_400);
    }

    await runBackup();

    const restantes = dumps();
    expect(restantes).toHaveLength(7);
    expect(restantes.filter((f) => !f.startsWith('backup-antigo-'))).toHaveLength(1);
    expect(restantes).not.toContain('backup-antigo-7.dump');
    expect(restantes).not.toContain('backup-antigo-6.dump');
  });
});
