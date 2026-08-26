import { generate } from '@pdfme/generator';
import type { Template } from '@pdfme/common';
import PDFDocument from 'pdfkit';
import prisma from '../config/database.js';

const FONT_URL = 'https://fonts.gstatic.com/s/notosans/v36/o-0IIpQlx3QUlC5A4PNr5TRASf6M7Q.woff2';

async function fetchFont(): Promise<ArrayBuffer> {
  const res = await fetch(FONT_URL);
  return res.arrayBuffer();
}

export async function generateProposalPDF(dealId: string, tenantId: string): Promise<Buffer> {
  const deal = await prisma.deal.findFirst({
    where: { id: dealId, tenantId },
    include: {
      lead: { select: { name: true, email: true, company: true, phone: true } },
      company: { select: { name: true, domain: true } },
      assignedUser: { select: { name: true, email: true } },
      tenant: { select: { name: true } },
    },
  });

  if (!deal) {
    const err = new Error('Deal not found') as any;
    err.statusCode = 404;
    throw err;
  }

  const clientName = deal.lead?.name ?? deal.company?.name ?? 'Cliente';
  const clientCompany = deal.lead?.company ?? deal.company?.name ?? '';
  const clientEmail = deal.lead?.email ?? '';
  const salesRep = deal.assignedUser?.name ?? '';
  const closeDate = deal.expectedCloseDate
    ? deal.expectedCloseDate.toLocaleDateString('pt-BR')
    : '';
  const valueFormatted = new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(Number(deal.value));

  const fontData = await fetchFont();
  const font = { NotoSans: { data: fontData, fallback: true } };

  const template: Template = {
    basePdf: { width: 210, height: 297, padding: [20, 20, 20, 20] },
    schemas: [
      [
        {
          name: 'header',
          type: 'text',
          position: { x: 20, y: 20 },
          width: 170,
          height: 12,
          fontSize: 20,
          fontName: 'NotoSans',
          fontColor: '#1e3a5f',
          alignment: 'left',
        },
        {
          name: 'subheader',
          type: 'text',
          position: { x: 20, y: 36 },
          width: 170,
          height: 8,
          fontSize: 12,
          fontName: 'NotoSans',
          fontColor: '#64748b',
          alignment: 'left',
        },
        {
          name: 'divider',
          type: 'line',
          position: { x: 20, y: 48 },
          width: 170,
          height: 0.5,
          color: '#e2e8f0',
        },
        {
          name: 'section_client',
          type: 'text',
          position: { x: 20, y: 56 },
          width: 170,
          height: 7,
          fontSize: 11,
          fontName: 'NotoSans',
          fontColor: '#374151',
          fontWeight: 'bold',
        },
        {
          name: 'client_name',
          type: 'text',
          position: { x: 20, y: 66 },
          width: 170,
          height: 7,
          fontSize: 10,
          fontName: 'NotoSans',
          fontColor: '#1f2937',
        },
        {
          name: 'client_company',
          type: 'text',
          position: { x: 20, y: 75 },
          width: 170,
          height: 7,
          fontSize: 10,
          fontName: 'NotoSans',
          fontColor: '#1f2937',
        },
        {
          name: 'client_email',
          type: 'text',
          position: { x: 20, y: 84 },
          width: 170,
          height: 7,
          fontSize: 10,
          fontName: 'NotoSans',
          fontColor: '#1f2937',
        },
        {
          name: 'divider2',
          type: 'line',
          position: { x: 20, y: 95 },
          width: 170,
          height: 0.5,
          color: '#e2e8f0',
        },
        {
          name: 'section_deal',
          type: 'text',
          position: { x: 20, y: 103 },
          width: 170,
          height: 7,
          fontSize: 11,
          fontName: 'NotoSans',
          fontColor: '#374151',
          fontWeight: 'bold',
        },
        {
          name: 'deal_name',
          type: 'text',
          position: { x: 20, y: 113 },
          width: 170,
          height: 7,
          fontSize: 10,
          fontName: 'NotoSans',
          fontColor: '#1f2937',
        },
        {
          name: 'deal_value',
          type: 'text',
          position: { x: 20, y: 122 },
          width: 170,
          height: 10,
          fontSize: 18,
          fontName: 'NotoSans',
          fontColor: '#2563eb',
          fontWeight: 'bold',
        },
        {
          name: 'deal_close',
          type: 'text',
          position: { x: 20, y: 136 },
          width: 170,
          height: 7,
          fontSize: 10,
          fontName: 'NotoSans',
          fontColor: '#1f2937',
        },
        {
          name: 'deal_notes',
          type: 'text',
          position: { x: 20, y: 150 },
          width: 170,
          height: 60,
          fontSize: 10,
          fontName: 'NotoSans',
          fontColor: '#374151',
        },
        {
          name: 'footer',
          type: 'text',
          position: { x: 20, y: 270 },
          width: 170,
          height: 7,
          fontSize: 9,
          fontName: 'NotoSans',
          fontColor: '#94a3b8',
          alignment: 'center',
        },
      ],
    ],
  };

  const inputs = [
    {
      header: `Proposta Comercial — ${deal.tenant.name}`,
      subheader: `Negócio: ${deal.name}`,
      section_client: 'Dados do Cliente',
      client_name: `Nome: ${clientName}`,
      client_company: clientCompany ? `Empresa: ${clientCompany}` : '',
      client_email: clientEmail ? `E-mail: ${clientEmail}` : '',
      section_deal: 'Detalhes da Proposta',
      deal_name: `Descrição: ${deal.name}`,
      deal_value: valueFormatted,
      deal_close: closeDate ? `Previsão de fechamento: ${closeDate}` : '',
      deal_notes: deal.notes ?? '',
      footer: salesRep ? `Gerado por ${salesRep} via VYD Engage` : 'Gerado via VYD Engage',
    },
  ];

  const pdf = await generate({ template, inputs, options: { font } });
  return Buffer.from(pdf.buffer);
}

// ─── Proposta a partir de MODELO (Upgrade RD P2, req 18) ─────────────────────
// Renderiza o corpo do modelo já com variáveis resolvidas + a tabela de itens
// do deal, num PDF de fluxo livre (pdfkit; fonte Helvetica embutida cobre os
// acentos pt-BR via WinAnsi). Layout flexível p/ corpo e tabela de tamanho
// variável — sem dependência externa nova.

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

export interface ProposalItemLine {
  name: string;
  quantity: number;
  unitPrice: number;
  discount: number; // percentual (0-100)
  subtotal: number;
}

export interface ProposalPdfInput {
  tenantName: string;
  title: string; // cabeçalho (nome do modelo/proposta)
  clientName?: string;
  clientCompany?: string;
  clientEmail?: string;
  version: number;
  bodyText: string; // corpo do modelo já interpolado (texto estruturado, sem HTML)
  items: ProposalItemLine[];
  total: number;
  generatedBy?: string;
}

/**
 * Gera o PDF de uma proposta a partir do corpo (já interpolado) + itens do deal.
 * Deterministic (sem rede) — bom p/ teste com mock. Retorna o Buffer do PDF.
 */
export function renderProposalPdf(input: ProposalPdfInput): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', margin: 50 });
      const chunks: Buffer[] = [];
      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const accent = '#1e3a5f';
      const muted = '#64748b';
      const ink = '#1f2937';

      // Cabeçalho
      doc.fillColor(accent).fontSize(20).font('Helvetica-Bold').text(input.title || 'Proposta Comercial');
      doc
        .moveDown(0.2)
        .fillColor(muted)
        .fontSize(11)
        .font('Helvetica')
        .text(`${input.tenantName} — versão ${input.version}`);
      doc.moveDown(0.5);
      doc
        .strokeColor('#e2e8f0')
        .lineWidth(0.5)
        .moveTo(doc.page.margins.left, doc.y)
        .lineTo(doc.page.width - doc.page.margins.right, doc.y)
        .stroke();
      doc.moveDown(0.8);

      // Dados do cliente
      const clientLines = [
        input.clientName ? `Cliente: ${input.clientName}` : '',
        input.clientCompany ? `Empresa: ${input.clientCompany}` : '',
        input.clientEmail ? `E-mail: ${input.clientEmail}` : '',
      ].filter(Boolean);
      if (clientLines.length) {
        doc.fillColor(ink).fontSize(10).font('Helvetica');
        for (const line of clientLines) doc.text(line);
        doc.moveDown(0.8);
      }

      // Corpo do modelo (texto interpolado; parágrafos separados por linha em branco)
      if (input.bodyText.trim()) {
        doc.fillColor(ink).fontSize(11).font('Helvetica');
        const paragraphs = input.bodyText.split(/\n{2,}/);
        for (const para of paragraphs) {
          const text = para.trim();
          if (!text) continue;
          doc.text(text, { align: 'left' });
          doc.moveDown(0.5);
        }
        doc.moveDown(0.3);
      }

      // Tabela de itens
      if (input.items.length) {
        doc.fillColor(accent).fontSize(12).font('Helvetica-Bold').text('Itens');
        doc.moveDown(0.4);

        const left = doc.page.margins.left;
        const right = doc.page.width - doc.page.margins.right;
        const colName = left;
        const colQty = right - 200;
        const colPrice = right - 140;
        const colDisc = right - 70;
        const colSub = right - 5;

        const header = (y: number) => {
          doc.fillColor(muted).fontSize(9).font('Helvetica-Bold');
          doc.text('Item', colName, y, { width: colQty - colName - 4 });
          doc.text('Qtd', colQty - 20, y, { width: 40, align: 'right' });
          doc.text('Preço', colPrice - 20, y, { width: 55, align: 'right' });
          doc.text('Desc.', colDisc - 20, y, { width: 40, align: 'right' });
          doc.text('Subtotal', colSub - 65, y, { width: 65, align: 'right' });
        };
        header(doc.y);
        doc.moveDown(0.3);
        doc
          .strokeColor('#e2e8f0')
          .lineWidth(0.5)
          .moveTo(left, doc.y)
          .lineTo(right, doc.y)
          .stroke();
        doc.moveDown(0.3);

        doc.fillColor(ink).fontSize(9).font('Helvetica');
        for (const item of input.items) {
          if (doc.y > doc.page.height - doc.page.margins.bottom - 60) {
            doc.addPage();
            header(doc.y);
            doc.moveDown(0.5);
          }
          const rowY = doc.y;
          doc.text(item.name, colName, rowY, { width: colQty - colName - 24 });
          const lineY = rowY;
          doc.text(String(item.quantity), colQty - 20, lineY, { width: 40, align: 'right' });
          doc.text(BRL.format(item.unitPrice), colPrice - 20, lineY, { width: 55, align: 'right' });
          doc.text(`${item.discount}%`, colDisc - 20, lineY, { width: 40, align: 'right' });
          doc.text(BRL.format(item.subtotal), colSub - 65, lineY, { width: 65, align: 'right' });
          doc.moveDown(0.5);
        }

        doc.moveDown(0.3);
        doc
          .strokeColor('#e2e8f0')
          .lineWidth(0.5)
          .moveTo(left, doc.y)
          .lineTo(right, doc.y)
          .stroke();
        doc.moveDown(0.4);
        doc
          .fillColor(accent)
          .fontSize(13)
          .font('Helvetica-Bold')
          .text(`Total: ${BRL.format(input.total)}`, left, doc.y, { align: 'right' });
      }

      // Rodapé
      doc.moveDown(2);
      doc
        .fillColor(muted)
        .fontSize(9)
        .font('Helvetica')
        .text(
          input.generatedBy ? `Gerado por ${input.generatedBy} via VYD Engage` : 'Gerado via VYD Engage',
          { align: 'center' }
        );

      doc.end();
    } catch (err) {
      reject(err as Error);
    }
  });
}

// ─── Dossiê de habilitação técnica + Currículo estratégico (Atestados) ────────
// Reusa pdfkit (offline/determinístico). Reqs 24 e 34.

const AT_ACCENT = '#1e3a5f';
const AT_MUTED = '#64748b';
const AT_INK = '#1f2937';
const AT_LINE = '#e2e8f0';

const STATUS_LABEL: Record<string, string> = {
  ATENDE: 'Atende',
  ATENDE_PARCIAL: 'Atende parcial',
  NAO_ATENDE: 'Não atende',
  REVISAR: 'Revisar',
};

export interface DossierMatchLine {
  atestadoNumero: string;
  contratante: string;
  status: string;
  confianca?: number | null;
  quantComprovado?: number | null;
  incluido: boolean;
  origem?: string;
  parceiro?: string | null; // empresa dona (atestado de terceiro) — p/ consórcio
}
export interface DossierExigenciaLine {
  descricao: string;
  statusAgregado: string;
  grandeza?: string | null;
  quantMinimo?: number | null;
  unidade?: string | null;
  matches: DossierMatchLine[];
}
export interface DossierCurriculoLine {
  profissional: string;
  corpo: string;
  rtDesligado?: boolean;
}
export interface DossierAtestadoLine {
  numero: string;
  contratante: string;
  objeto: string;
  catNumero?: string | null;
  origem?: string;
  parceiro?: string | null;
  responsaveis?: string[];
}
export interface DossierPdfInput {
  tenantName: string;
  concorrenciaTitulo: string;
  orgao?: string | null;
  dataGeracao?: string;
  exigencias: DossierExigenciaLine[];
  atestados: DossierAtestadoLine[];
  curriculos: DossierCurriculoLine[];
  generatedBy?: string;
}

function atHeader(doc: PDFKit.PDFDocument, title: string, subtitle: string) {
  doc.fillColor(AT_ACCENT).fontSize(19).font('Helvetica-Bold').text(title);
  doc.moveDown(0.2).fillColor(AT_MUTED).fontSize(11).font('Helvetica').text(subtitle);
  doc.moveDown(0.5);
  doc
    .strokeColor(AT_LINE)
    .lineWidth(0.5)
    .moveTo(doc.page.margins.left, doc.y)
    .lineTo(doc.page.width - doc.page.margins.right, doc.y)
    .stroke();
  doc.moveDown(0.8);
}

function atPageBreak(doc: PDFKit.PDFDocument, reserve = 80) {
  if (doc.y > doc.page.height - doc.page.margins.bottom - reserve) doc.addPage();
}

/** Gera o dossiê de habilitação técnica (matriz de atendimento + currículos). */
export function renderDossierPdf(input: DossierPdfInput): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', margin: 50 });
      const chunks: Buffer[] = [];
      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      // ── Capa ──────────────────────────────────────────────────────────────
      doc.moveDown(6);
      doc.fillColor(AT_ACCENT).fontSize(26).font('Helvetica-Bold').text('Dossiê de Habilitação Técnica', { align: 'center' });
      doc.moveDown(1);
      doc.fillColor(AT_INK).fontSize(15).font('Helvetica-Bold').text(input.concorrenciaTitulo, { align: 'center' });
      if (input.orgao) doc.moveDown(0.3).fillColor(AT_MUTED).fontSize(12).font('Helvetica').text(input.orgao, { align: 'center' });
      doc.moveDown(1.5);
      doc.fillColor(AT_MUTED).fontSize(11).font('Helvetica').text(input.tenantName || 'VYD Engage', { align: 'center' });
      if (input.dataGeracao) doc.moveDown(0.2).text(`Gerado em ${input.dataGeracao}`, { align: 'center' });

      // ── Índice ────────────────────────────────────────────────────────────
      doc.moveDown(4);
      doc.fillColor(AT_ACCENT).fontSize(13).font('Helvetica-Bold').text('Índice', { align: 'left' });
      doc.moveDown(0.4).fillColor(AT_INK).fontSize(11).font('Helvetica');
      doc.text('1. Matriz de Atendimento');
      doc.text('2. Atestados Selecionados');
      if (input.curriculos.length) doc.text('3. Equipe Técnica');

      // ── 1. Matriz de Atendimento ──────────────────────────────────────────
      doc.addPage();
      doc.fillColor(AT_ACCENT).fontSize(15).font('Helvetica-Bold').text('1. Matriz de Atendimento');
      doc.moveDown(0.5);

      input.exigencias.forEach((ex, idx) => {
        atPageBreak(doc, 120);
        doc.fillColor(AT_INK).fontSize(11).font('Helvetica-Bold').text(`${idx + 1}. ${ex.descricao}`);
        const meta: string[] = [`Status: ${STATUS_LABEL[ex.statusAgregado] ?? ex.statusAgregado}`];
        if (ex.quantMinimo != null) meta.push(`Mínimo: ${ex.quantMinimo} ${ex.unidade ?? ''}`.trim());
        doc.moveDown(0.1).fillColor(AT_MUTED).fontSize(9).font('Helvetica').text(meta.join('  ·  '));
        doc.moveDown(0.2);

        const included = ex.matches.filter((m) => m.incluido);
        if (included.length === 0) {
          doc.fillColor('#b91c1c').fontSize(9).font('Helvetica-Oblique').text('  Sem atestado que comprove esta exigência (lacuna).');
        } else {
          doc.fillColor(AT_INK).fontSize(9).font('Helvetica');
          for (const m of included) {
            const dono = m.origem === 'TERCEIRO' ? ` [terceiro: ${m.parceiro ?? 'parceiro'}]` : '';
            const parts = [
              `  • Atestado ${m.atestadoNumero} — ${m.contratante}${dono}`,
              STATUS_LABEL[m.status] ?? m.status,
            ];
            if (m.quantComprovado != null) parts.push(`comprovado ${m.quantComprovado}`);
            if (m.confianca != null) parts.push(`conf. ${(m.confianca * 100).toFixed(0)}%`);
            doc.text(parts.join('  ·  '));
          }
        }
        doc.moveDown(0.5);
      });

      // ── 2. Atestados Selecionados ─────────────────────────────────────────
      doc.addPage();
      doc.fillColor(AT_ACCENT).fontSize(15).font('Helvetica-Bold').text('2. Atestados Selecionados');
      doc.moveDown(0.5);
      if (input.atestados.length === 0) {
        doc.fillColor(AT_MUTED).fontSize(10).font('Helvetica').text('Nenhum atestado incluído na composição.');
      }
      for (const a of input.atestados) {
        atPageBreak(doc, 110);
        const dono = a.origem === 'TERCEIRO' ? `  [terceiro: ${a.parceiro ?? 'parceiro'}]` : '';
        doc.fillColor(AT_INK).fontSize(11).font('Helvetica-Bold').text(`Atestado ${a.numero} — ${a.contratante}${dono}`);
        const linha2: string[] = [];
        if (a.catNumero) linha2.push(`CAT ${a.catNumero}`);
        if (a.responsaveis?.length) linha2.push(a.responsaveis.join(', '));
        if (linha2.length) doc.moveDown(0.1).fillColor(AT_MUTED).fontSize(9).font('Helvetica').text(linha2.join('  ·  '));
        doc.fillColor(AT_INK).fontSize(9).font('Helvetica').text(a.objeto.slice(0, 700));
        doc.moveDown(0.5);
      }

      // ── 3. Equipe Técnica (currículos) ────────────────────────────────────
      if (input.curriculos.length) {
        doc.addPage();
        doc.fillColor(AT_ACCENT).fontSize(15).font('Helvetica-Bold').text('3. Equipe Técnica');
        doc.moveDown(0.5);
        for (const c of input.curriculos) {
          atPageBreak(doc, 120);
          doc.fillColor(AT_INK).fontSize(11).font('Helvetica-Bold').text(c.profissional);
          if (c.rtDesligado) {
            doc.moveDown(0.1).fillColor('#b91c1c').fontSize(9).font('Helvetica-Oblique').text('  Profissional DESLIGADO — o acervo técnico-profissional dele não habilita a empresa.');
          }
          doc.moveDown(0.2).fillColor(AT_INK).fontSize(10).font('Helvetica');
          for (const para of c.corpo.split(/\n{2,}/)) {
            const t = para.trim();
            if (t) {
              atPageBreak(doc, 60);
              doc.text(t);
              doc.moveDown(0.3);
            }
          }
          doc.moveDown(0.5);
        }
      }

      doc.moveDown(1);
      doc
        .fillColor(AT_MUTED)
        .fontSize(9)
        .font('Helvetica')
        .text(input.generatedBy ? `Gerado por ${input.generatedBy} via VYD Engage` : 'Gerado via VYD Engage', {
          align: 'center',
        });
      doc.end();
    } catch (err) {
      reject(err as Error);
    }
  });
}

export interface CurriculoAtestadoLine {
  numero: string;
  contratante: string;
  objeto: string;
  funcoes: string[];
}
export interface CurriculoPdfInput {
  tenantName: string;
  profissionalNome: string;
  titulo: string;
  subtitulo?: string;
  corpo: string;
  alertaRtDesligado?: boolean;
  atestados: CurriculoAtestadoLine[];
  generatedBy?: string;
}

/** Gera o currículo estratégico de um profissional (com os atestados aderentes). */
export function renderCurriculoPdf(input: CurriculoPdfInput): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', margin: 50 });
      const chunks: Buffer[] = [];
      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      atHeader(doc, input.profissionalNome, input.subtitulo ? `${input.titulo} · ${input.subtitulo}` : input.titulo);

      if (input.alertaRtDesligado) {
        doc
          .fillColor('#b91c1c')
          .fontSize(9)
          .font('Helvetica-Oblique')
          .text('Atenção: profissional DESLIGADO — o acervo técnico-profissional dele não habilita a empresa.');
        doc.moveDown(0.5);
      }

      if (input.corpo.trim()) {
        doc.fillColor(AT_INK).fontSize(11).font('Helvetica');
        for (const para of input.corpo.split(/\n{2,}/)) {
          const t = para.trim();
          if (t) {
            atPageBreak(doc, 60);
            doc.text(t);
            doc.moveDown(0.4);
          }
        }
        doc.moveDown(0.5);
      }

      if (input.atestados.length) {
        atPageBreak(doc, 100);
        doc.fillColor(AT_ACCENT).fontSize(13).font('Helvetica-Bold').text('Acervo Técnico');
        doc.moveDown(0.5);
        input.atestados.forEach((a) => {
          atPageBreak(doc, 90);
          doc.fillColor(AT_INK).fontSize(10).font('Helvetica-Bold').text(`Atestado ${a.numero} — ${a.contratante}`);
          if (a.funcoes.length) {
            doc.fillColor(AT_MUTED).fontSize(9).font('Helvetica').text(a.funcoes.join('  ·  '));
          }
          doc.fillColor(AT_INK).fontSize(9).font('Helvetica').text(a.objeto.slice(0, 600));
          doc.moveDown(0.5);
        });
      }

      doc.moveDown(1);
      doc
        .fillColor(AT_MUTED)
        .fontSize(9)
        .font('Helvetica')
        .text(input.generatedBy ? `Gerado por ${input.generatedBy} via VYD Engage` : 'Gerado via VYD Engage', {
          align: 'center',
        });
      doc.end();
    } catch (err) {
      reject(err as Error);
    }
  });
}

// ─── Relatório Executivo — Parceiros Comerciais (PRM) ─────────────────────────
// Reusa pdfkit (offline/determinístico), mesmo estilo do dossiê de atestados.

const FAIXA_LABEL: Record<string, string> = {
  SAUDAVEL: 'Saudável',
  ATENCAO: 'Atenção',
  ESFRIANDO: 'Esfriando',
  FRIO: 'Frio',
};

export interface ParceiroReportConsultorLine {
  nome: string;
  faixa: string | null;
  score: number | null;
  diasSemAtividade: number | null;
  registrosAtivos: number;
  pipeline: number;
  ganho: number;
  metaPct: number | null;
}

export interface ParceiroReportPdfInput {
  tenantName: string;
  periodo: string;
  dataGeracao: string;
  indicadores: {
    consultoresAtivos: number;
    consultoresDormentes: number;
    pipelineParceiros: number;
    ganhoPeriodo: number;
    conflitosAbertos: number;
    conflitosResolvidos?: number;
    registrosPendentes: number;
    comissoesLiberadas: number;
    tempoMedioAprovacaoDias?: number;
    taxaExpiracao?: number;
  };
  consultores: ParceiroReportConsultorLine[];
  generatedBy?: string;
}

/** Gera o relatório executivo do programa de parceiros (indicadores + consultores). */
export function renderParceiroReportPdf(input: ParceiroReportPdfInput): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', margin: 50 });
      const chunks: Buffer[] = [];
      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      // ── Capa ──────────────────────────────────────────────────────────────
      atHeader(
        doc,
        'Relatório Executivo — Parceiros Comerciais',
        `${input.periodo} · ${input.tenantName} · Gerado em ${input.dataGeracao}`
      );

      // ── Indicadores do Programa ───────────────────────────────────────────
      doc.fillColor(AT_ACCENT).fontSize(13).font('Helvetica-Bold').text('Indicadores do Programa');
      doc.moveDown(0.5);

      const ind = input.indicadores;
      // Dois grupos SEPARADOS de propósito: misturá-los faria números acumulados
      // parecerem do período impresso no cabeçalho. "No período" é filtrado pela
      // janela; "Posição atual" é uma foto de agora, independente da janela.
      const doPeriodo: Array<[string, string]> = [
        ['Ganho no período', BRL.format(ind.ganhoPeriodo)],
        ['Comissões liberadas', BRL.format(ind.comissoesLiberadas)],
        ...(ind.conflitosResolvidos != null
          ? ([['Conflitos resolvidos', String(ind.conflitosResolvidos)]] as Array<[string, string]>)
          : []),
        ...(ind.tempoMedioAprovacaoDias != null
          ? ([
              ['Tempo médio de aprovação', `${ind.tempoMedioAprovacaoDias} dias`],
            ] as Array<[string, string]>)
          : []),
      ];
      const posicaoAtual: Array<[string, string]> = [
        ['Consultores ativos', String(ind.consultoresAtivos)],
        ['Consultores dormentes', String(ind.consultoresDormentes)],
        ['Pipeline de parceiros', BRL.format(ind.pipelineParceiros)],
        ['Conflitos abertos', String(ind.conflitosAbertos)],
        ['Registros aguardando aprovação', String(ind.registrosPendentes)],
        // Acumulada: EXPIRADO não carimba data de decisão, então não há como
        // recortá-la por janela sem inventar o dado.
        ...(ind.taxaExpiracao != null
          ? ([['Taxa de expiração (acumulada)', `${ind.taxaExpiracao}%`]] as Array<[string, string]>)
          : []),
      ];

      const escreveGrupo = (titulo: string, linhas: Array<[string, string]>) => {
        atPageBreak(doc, 80);
        doc.fillColor(AT_INK).fontSize(10).font('Helvetica-Bold').text(titulo);
        doc.moveDown(0.3);
        for (const [rotulo, valor] of linhas) {
          atPageBreak(doc, 60);
          doc.fillColor(AT_MUTED).fontSize(10).font('Helvetica').text(`${rotulo}: `, { continued: true });
          doc.fillColor(AT_INK).font('Helvetica-Bold').text(valor);
          doc.moveDown(0.2);
        }
        doc.moveDown(0.6);
      };

      escreveGrupo(`No período (${input.periodo})`, doPeriodo);
      escreveGrupo('Posição atual', posicaoAtual);
      doc.moveDown(0.2);

      // ── Consultores ───────────────────────────────────────────────────────
      atPageBreak(doc, 100);
      doc.fillColor(AT_ACCENT).fontSize(13).font('Helvetica-Bold').text('Consultores');
      doc.moveDown(0.5);

      if (input.consultores.length === 0) {
        doc.fillColor(AT_MUTED).fontSize(10).font('Helvetica').text('Nenhum consultor no período.');
      }
      for (const c of input.consultores) {
        atPageBreak(doc, 80);
        doc.fillColor(AT_INK).fontSize(11).font('Helvetica-Bold').text(c.nome);
        const meta: string[] = [];
        if (c.faixa != null) meta.push(FAIXA_LABEL[c.faixa] ?? c.faixa);
        if (c.score != null) meta.push(`score ${c.score.toFixed(0)}`);
        if (c.diasSemAtividade != null) meta.push(`${c.diasSemAtividade} dias sem atividade`);
        meta.push(`${c.registrosAtivos} registros ativos`);
        meta.push(`pipeline ${BRL.format(c.pipeline)}`);
        meta.push(`ganho no período ${BRL.format(c.ganho)}`);
        if (c.metaPct != null) meta.push(`meta ${c.metaPct.toFixed(0)}%`);
        doc.moveDown(0.1).fillColor(AT_MUTED).fontSize(9).font('Helvetica').text(meta.join('  ·  '));
        doc.moveDown(0.5);
      }

      doc.moveDown(1);
      doc
        .fillColor(AT_MUTED)
        .fontSize(9)
        .font('Helvetica')
        .text(input.generatedBy ? `Gerado por ${input.generatedBy} via VYD Engage` : 'Gerado via VYD Engage', {
          align: 'center',
        });
      doc.end();
    } catch (err) {
      reject(err as Error);
    }
  });
}
