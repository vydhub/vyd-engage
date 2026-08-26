#!/usr/bin/env node
/**
 * check-hardcoded-colors.mjs — Gate de 0 cor codificada (spec design-system-migration, Fase 8).
 *
 * Proíbe cores hardcoded em src/**\/*.{ts,tsx,css}:
 *   - hex 3/4/6/8 dígitos (#fff, #ffff, #ffffff, #ffffffff)
 *   - rgb()/rgba()/hsl()/hsla() com literais (var(...) é permitido; color-mix é permitido)
 *
 * Toda cor deve ser token do DS: var(--vyd-*) / classe .vyd-* / utilitário do preset.
 *
 * Escapes (cada um exige justificativa):
 *   - ALLOWLIST_FILES: arquivos self-contained (PDF/Excel/e-mail), seletores internos
 *     de libs, dados do usuário e mocks de teste — não podem usar var(--vyd-*).
 *   - Comentário `gate-allow` na MESMA linha: escape pontual (ex.: color-picker do tenant).
 *
 * Uso: node scripts/check-hardcoded-colors.mjs  → exit(1) se achar violação fora dos escapes.
 * Cross-platform (Node puro, sem deps).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const ROOT = process.cwd();
const SRC = join(ROOT, 'src');

// Allowlist central de ARQUIVOS (caminho relativo com "/") + justificativa obrigatória.
const ALLOWLIST_FILES = {
  'src/utils/reportExport.ts':
    'Documento self-contained (PDF via print + Excel via ExcelJS ARGB); não carrega theme.css, usa REPORT_PALETTE (hex resolvidos do DS).',
  'src/utils/excelExport.ts':
    'Documento self-contained (Excel via ExcelJS ARGB); não carrega theme.css, usa EXCEL_PALETTE (ARGB resolvidos do DS).',
  'src/components/email/GrapesEmailBuilder.tsx':
    'E-mail HTML exige cor inline literal (clientes de e-mail não suportam var()); usa EMAIL_PALETTE (hex resolvidos do DS).',
  'src/components/ui/chart.tsx':
    "Os hex (#ccc/#fff) são SELETORES de atributo que casam com a saída interna do Recharts ([stroke='#ccc']); não são cores aplicadas.",
  'src/test/handlers.ts': 'Mock de teste (MSW); não é UI de produção.',
};

// Extensões escaneadas.
const EXTS = new Set(['.ts', '.tsx', '.css']);
// Arquivos ignorados (artefato pré-compilado descontinuado).
const IGNORE_FILES = new Set(['src/index.css']);

// hex 3/4/6/8 dígitos. (?<!&) exclui entidades HTML numéricas (&#123; = "{").
const HEX = /(?<!&)#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})\b/;
// rgb()/rgba()/hsl()/hsla() NÃO seguidos de var( — literais proibidos (color-mix é permitido).
// Flag i: pega também RGB(/HSL( maiúsculos (case-insensitive em CSS/JS).
const FUNC = /\b(?:rgba?|hsla?)\(\s*(?!var\()/i;
// ARGB do ExcelJS (argb: 'FFRRGGBB') — cor literal SEM '#', que o regex HEX não pega.
const ARGB = /\bargb\s*:\s*['"][0-9a-fA-F]{8}\b/i;
// Família Tailwind `slate-*` (regressão nomeada) — proibida; use tokens --vyd-*.
// Casa utilitários de cor: bg-/text-/border-/ring-/from-/to-/via-/divide-/placeholder-/fill-/stroke-/decoration-/outline-/accent-slate-<num>.
const SLATE =
  /\b(?:bg|text|border|ring|from|to|via|divide|placeholder|fill|stroke|decoration|outline|accent)-slate-\d{2,3}\b/;

// Escopo ESTRITO: arquivos JÁ 100% tokenizados (primitivos compartilhados + feature
// de Playbook/Desdobramento). Nestes, QUALQUER família de cor Tailwind crua (fora do
// mapa de tokens do DS) — gray/zinc/neutral/stone e todo o arco-íris + white/black —
// é proibida, prevenindo a regressão que os reqs 14/15 corrigiram. Fora deste escopo,
// o legado (gray-* bridged etc.) permanece — migrá-lo é fora do escopo desta spec.
const STRICT_SCOPE = new Set([
  'src/components/ui/RichTextEditor.tsx',
  'src/components/ui/select.tsx',
  'src/components/ui/timeline.tsx',
  'src/components/ui/badge.tsx',
  'src/components/ui/button.tsx',
  'src/components/comercial/PlaybooksManager.tsx',
  'src/components/comercial/RoadmapCreateDialog.tsx',
  // Follow-up de Clientes & Contratos (spec followup-clientes-contratos):
  // arquivos novos nascem 100% tokenizados.
  'src/components/companies/CompanyBadges.tsx',
  'src/components/companies/ContractCard.tsx',
  'src/components/companies/ExpiringContractsWidget.tsx',
  'src/components/settings/FollowUpSettingsTab.tsx',
  // Upgrade RD parity — P0 (spec upgrade-rd-parity): arquivos novos nascem
  // 100% tokenizados.
  'src/components/TodayTasksPanel.tsx',
  'src/components/deals/QualificationStars.tsx',
  'src/components/deals/QuestionnaireSection.tsx',
  'src/components/deals/SendEmailDialog.tsx',
  'src/components/deals/MultiSaleDialog.tsx',
  'src/components/deals/CelebrationModal.tsx',
  'src/components/deals/ScheduledDealsSection.tsx',
  'src/components/settings/QualificationTab.tsx',
  'src/components/settings/QuestionnairesTab.tsx',
  'src/components/settings/FieldPresetsTab.tsx',
  'src/components/settings/ManagerTriggersTab.tsx',
  'src/components/settings/EmailTemplatesTab.tsx',
  'src/components/settings/PresetField.tsx',
  'src/components/settings/SalesFlagsTab.tsx',
  // Upgrade RD parity — P1 (times & governança): arquivos novos nascem
  // 100% tokenizados.
  'src/pages/Approvals.tsx',
  'src/pages/Trash.tsx',
  'src/components/settings/permissions/PermissionsTab.tsx',
  'src/components/settings/permissions/PermissionProfileEditor.tsx',
  'src/components/settings/permissions/BuiltinProfileViewer.tsx',
  'src/components/settings/permissions/permissionLabels.ts',
  'src/components/settings/permissions/permissionDefaults.ts',
  'src/components/settings/teams/TeamsTab.tsx',
  // Upgrade RD parity — P2 (integrações + click-to-call): arquivos novos nascem
  // 100% tokenizados.
  'src/components/integrations/SignatureConfigCard.tsx',
  'src/components/integrations/PhoneConfigCard.tsx',
  'src/components/phone/CallButton.tsx',
  // Upgrade RD parity — P2 (arquivos + propostas no deal/empresa): arquivos
  // novos nascem 100% tokenizados.
  'src/components/attachments/AttachmentsTab.tsx',
  'src/components/deals/ProposalsSection.tsx',
  // Upgrade RD parity — P3 (WhatsApp & IA / reuniões): arquivos novos nascem
  // 100% tokenizados.
  'src/components/deals/MeetingsSection.tsx',
  // Gestão de Atestados Técnicos — módulo novo, 100% tokenizado.
  'src/pages/Atestados.tsx',
  'src/components/atestados/AcervoTab.tsx',
  'src/components/atestados/BuscaTab.tsx',
  'src/components/atestados/ConcorrenciasTab.tsx',
  'src/components/atestados/PendenciasTab.tsx',
  'src/components/atestados/ProfissionaisTab.tsx',
  'src/components/atestados/TerceirosTab.tsx',
  'src/components/atestados/ConfigTab.tsx',
  // Gestão de Parceiros Comerciais — módulo novo, 100% tokenizado.
  'src/pages/Parceiros.tsx',
  'src/pages/PortalParceiro.tsx',
  'src/components/parceiros/PainelTab.tsx',
  'src/components/parceiros/ConsultoresTab.tsx',
  'src/components/parceiros/RegistrosTab.tsx',
  'src/components/parceiros/ConflitosTab.tsx',
  'src/components/parceiros/ComissoesTab.tsx',
  'src/components/parceiros/RelacionamentoTab.tsx',
  'src/components/parceiros/DocsConfigTab.tsx',
  'src/components/parceiros/PortalOportunidades.tsx',
  'src/components/parceiros/PortalComissoes.tsx',
  'src/components/parceiros/PortalMetasReunioes.tsx',
  'src/components/parceiros/PortalDocumentos.tsx',
]);
const STRICT_FAMILIES =
  /\b(?:bg|text|border|ring|from|to|via|divide|placeholder|fill|stroke|decoration|outline|accent)-(?:gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b|\b(?:bg|text|border|ring|fill|stroke)-(?:white|black)\b/;

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (name === 'node_modules' || name === 'build' || name === 'dist') continue;
      out.push(...walk(full));
    } else {
      const ext = name.slice(name.lastIndexOf('.'));
      if (EXTS.has(ext)) out.push(full);
    }
  }
  return out;
}

const violations = [];
for (const file of walk(SRC)) {
  const rel = relative(ROOT, file).split(sep).join('/');
  if (IGNORE_FILES.has(rel)) continue;
  if (ALLOWLIST_FILES[rel]) continue;

  const lines = readFileSync(file, 'utf8').split(/\r?\n/);
  lines.forEach((line, i) => {
    if (line.includes('gate-allow')) return; // escape pontual por linha
    if (HEX.test(line) || FUNC.test(line) || ARGB.test(line)) {
      const m = line.match(HEX) || line.match(FUNC) || line.match(ARGB);
      violations.push({ rel, line: i + 1, text: line.trim().slice(0, 100), match: m[0] });
    }
    if (SLATE.test(line)) {
      const m = line.match(SLATE);
      violations.push({
        rel,
        line: i + 1,
        text: line.trim().slice(0, 100),
        match: m[0],
        reason: "família de cor Tailwind 'slate-*' proibida — use tokens --vyd-*",
      });
    }
    if (STRICT_SCOPE.has(rel) && STRICT_FAMILIES.test(line)) {
      const m = line.match(STRICT_FAMILIES);
      violations.push({
        rel,
        line: i + 1,
        text: line.trim().slice(0, 100),
        match: m[0],
        reason: 'família de cor Tailwind crua proibida neste arquivo tokenizado — use tokens do DS',
      });
    }
  });
}

if (violations.length > 0) {
  console.error(`\n✗ Cores codificadas encontradas (${violations.length}) fora da allowlist:\n`);
  for (const v of violations) {
    const why = v.reason ? `   [${v.reason}]` : '';
    console.error(`  ${v.rel}:${v.line}  →  ${v.match}${why}   | ${v.text}`);
  }
  console.error(
    '\nUse tokens do DS (var(--vyd-*) / classe .vyd-*). Para casos legítimos ' +
      '(documento self-contained, dado do usuário), adicione à ALLOWLIST_FILES com ' +
      'justificativa ou um comentário `gate-allow` na linha.\n'
  );
  process.exit(1);
}

console.log('✓ check:colors — 0 cor codificada fora da allowlist.');

// Imprime a allowlist para auditoria/transparência.
const n = Object.keys(ALLOWLIST_FILES).length;
console.log(`  (allowlist: ${n} arquivo(s) justificado(s) + escapes \`gate-allow\` por linha)`);
