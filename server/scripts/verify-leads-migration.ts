/**
 * Verificação READ-ONLY pós-migração 20260817000000_leads_oportunidade
 * (specs/leads-oportunidade-inteligencia-mercado.md, DoD Qualidade #3):
 *   npx tsx scripts/verify-leads-migration.ts
 *
 * Confere que:
 *  1. Lead.status e Lead.source só têm valores da régua NOVA;
 *  2. FunnelColumn.mappedStatus só tem valores novos (ou NULL);
 *  3. leads em status terminal têm statusReason preenchido (backfill OUTRO).
 */
import prisma from '../src/config/database.js';

const NEW_STATUSES = ['NOVO', 'EM_ANDAMENTO', 'PAUSADO', 'CANCELADO', 'ENCERRADO'];
const NEW_SOURCES = [
  'PROSPECCAO_ATIVA',
  'PORTAL_NOTICIAS_LINKEDIN',
  'EVENTO_FEIRA_SETORIAL',
  'NETWORKING_PESSOAL',
  'CLIENTE_RECORRENTE',
  'INDICACAO_PARCEIROS',
  'OUTROS',
];

async function main() {
  let ok = true;

  const byStatus = await prisma.$queryRaw<{ status: string; total: bigint }[]>`
    SELECT "status"::text AS status, count(*) AS total FROM "Lead" GROUP BY 1 ORDER BY 2 DESC`;
  console.log('Lead.status:', byStatus.map((r) => `${r.status}=${r.total}`).join('  '));
  const badStatus = byStatus.filter((r) => !NEW_STATUSES.includes(r.status));
  if (badStatus.length) {
    ok = false;
    console.error('✗ Status FORA da régua nova:', badStatus);
  } else {
    console.log('✓ Todos os status na régua nova');
  }

  const bySource = await prisma.$queryRaw<{ source: string; total: bigint }[]>`
    SELECT "source"::text AS source, count(*) AS total FROM "Lead" GROUP BY 1 ORDER BY 2 DESC`;
  console.log('Lead.source:', bySource.map((r) => `${r.source}=${r.total}`).join('  '));
  const badSource = bySource.filter((r) => !NEW_SOURCES.includes(r.source));
  if (badSource.length) {
    ok = false;
    console.error('✗ Origem FORA da régua nova:', badSource);
  } else {
    console.log('✓ Todas as origens na régua nova');
  }

  const byMapped = await prisma.$queryRaw<{ mapped: string | null; total: bigint }[]>`
    SELECT "mappedStatus"::text AS mapped, count(*) AS total FROM "FunnelColumn" GROUP BY 1 ORDER BY 2 DESC`;
  console.log(
    'FunnelColumn.mappedStatus:',
    byMapped.map((r) => `${r.mapped ?? 'NULL'}=${r.total}`).join('  ')
  );
  const badMapped = byMapped.filter((r) => r.mapped !== null && !NEW_STATUSES.includes(r.mapped));
  if (badMapped.length) {
    ok = false;
    console.error('✗ mappedStatus FORA da régua nova:', badMapped);
  } else {
    console.log('✓ mappedStatus só com valores novos/NULL');
  }

  const semMotivo = await prisma.$queryRaw<{ total: bigint }[]>`
    SELECT count(*) AS total FROM "Lead"
    WHERE "status"::text IN ('PAUSADO','CANCELADO','ENCERRADO') AND "statusReason" IS NULL`;
  const faltando = Number(semMotivo[0]?.total ?? 0);
  if (faltando > 0) {
    ok = false;
    console.error(`✗ ${faltando} lead(s) terminais SEM statusReason (backfill falhou)`);
  } else {
    console.log('✓ Todo lead terminal tem statusReason (backfill ok)');
  }

  console.log(ok ? '\nVERIFICAÇÃO: TUDO OK' : '\nVERIFICAÇÃO: FALHAS ACIMA');
  process.exit(ok ? 0 : 1);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
