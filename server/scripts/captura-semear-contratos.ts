/**
 * Semeadura dos contratos (spec captura-demandas, filha 02, E-08 e E-09).
 *
 * Carrega a planilha aprovada na filha 01 (P-06, P-07) e gera os contratos das empresas
 * com `contractHolder = NOS` que a planilha não cobriu. É idempotente: rodar de novo não
 * muda nada e não duplica. Linha nova da planilha já está no Flow e não dispara o espelho.
 * Linha que altera número, empresa, gerente ou planejador de um contrato existente dispara
 * `contract.updated`, e o contrato gerado dos campos NOS, que não está lá, `contract.created`.
 * A falha na entrega vai para `espelhoFalhas`; a rotina periódica cobre o que ficou sem id (E-10).
 *
 * Uso (de `server/`):
 *   npx tsx scripts/captura-semear-contratos.ts --tenant <id> --csv <arquivo.csv> [--autor <userId>] [--seco] [--relatorio <arquivo.json>]
 *
 * --seco: confere tudo e gera o relatório, sem gravar e sem disparar nada.
 * --autor: usuário do tenant que responde pelo saldo de abertura (E-05). Obrigatório quando
 *          alguma linha traz consumo_inicial.
 *
 * CSV: UTF-8, separado por vírgula ou ponto e vírgula, com cabeçalho (ordem livre).
 *   Obrigatórias: flow_record_id, codigo, company_id
 *   Opcionais:    numero_cliente, tipo (LTA | GUARDA_CHUVA; padrão LTA), objeto, escopo,
 *                 vigencia_inicio e vigencia_fim (AAAA-MM-DD ou DD/MM/AAAA),
 *                 valor_contratado, consumo_inicial (dinheiro, "1234.56" ou "1.234,56"),
 *                 sla_resposta_horas, gerente_nome, gerente_email, planejador_nome,
 *                 planejador_email, solicitantes ("Nome <email>; Nome <email>"),
 *                 itens ("Descrição | Disciplina; Descrição")
 *
 * Regras (medições de 31/10 sobre a tabela do Flow):
 *  - `codigo` e `flow_record_id` são normalizados: sem espaço nem tabulação nas pontas.
 *  - Dois registros com o mesmo código depois de normalizar vão para `recusados`, sem
 *    escolher sozinho. O mesmo vale para `flow_record_id` repetido.
 *  - Sem gerente é aceito e aparece como lacuna. E-mail inválido recusa a linha.
 *  - `consumo_inicial` cria um único CONSUMO com motivo "Saldo de abertura", com autor e
 *    AuditLog.
 *  - Célula vazia não apaga dado já cadastrado: rodar de novo só muda o que veio preenchido.
 *    `tipo` em branco vale LTA só ao criar.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import prisma from '../src/config/database.js';
import { assertNotProdDatabase } from '../src/config/dbSafety.js';
import { lerCsv, semear } from '../src/services/captura/semeadura.js';

// ── Linha de comando ─────────────────────────────────────────────────────────────

function argumento(nome: string): string | undefined {
  const i = process.argv.indexOf(`--${nome}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function principal() {
  const tenantId = argumento('tenant');
  const csv = argumento('csv');
  if (!tenantId || !csv) {
    console.error(
      'Uso: tsx scripts/captura-semear-contratos.ts --tenant <id> --csv <arquivo> [--autor <userId>] [--seco] [--relatorio <arquivo>]'
    );
    process.exitCode = 2;
    return;
  }
  const seco = process.argv.includes('--seco');
  // Gravar em produção exige ALLOW_PROD_DB=true. O ensaio seco desfaz tudo ao final.
  if (!seco) assertNotProdDatabase('scripts/captura-semear-contratos.ts');

  const relatorio = await semear({
    tenantId,
    linhas: lerCsv(readFileSync(csv, 'utf8')),
    seco,
    autorId: argumento('autor'),
  });

  const destino = argumento('relatorio');
  if (destino) writeFileSync(destino, JSON.stringify(relatorio, null, 2));
  console.log(
    JSON.stringify(
      {
        seco,
        linhasLidas: relatorio.linhasLidas,
        criados: relatorio.criados.length,
        atualizados: relatorio.atualizados.length,
        semMudanca: relatorio.semMudanca.length,
        recusados: relatorio.recusados,
        saldosDeAbertura: relatorio.saldosDeAbertura.length,
        lacunas: relatorio.lacunas.length,
        ignorados: relatorio.ignorados,
        espelhoFalhas: relatorio.espelhoFalhas,
      },
      null,
      2
    )
  );
  await prisma.$disconnect();
}

principal().catch(async (erro) => {
  console.error(erro);
  process.exitCode = 1;
  await prisma.$disconnect();
});
