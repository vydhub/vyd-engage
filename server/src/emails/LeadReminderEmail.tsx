import { Heading, Text, Section } from '@react-email/components';
import { EmailLayout, emailStyles } from './EmailLayout.js';

export interface LeadReminderEmailProps {
  /** Nome (título) do lead-oportunidade. */
  leadName: string;
  /** Empresa vinculada (companyRef.name) ou texto legado; null quando ausente. */
  companyName: string | null;
  /** Dias corridos desde a criação do lead. */
  daysInProgress: number;
  /** Data formatada da última atividade (interação mais recente); null se nunca houve. */
  lastActivityLabel: string | null;
  /** Link absoluto para o detalhe do lead no app. */
  leadUrl: string;
}

/**
 * Lembrete de 30 dias (req. 47) — enviado ao responsável comercial de leads
 * EM_ANDAMENTO sem cobrança dentro da janela. JSX escapa os dados do usuário.
 */
export function LeadReminderEmail({
  leadName,
  companyName,
  daysInProgress,
  lastActivityLabel,
  leadUrl,
}: LeadReminderEmailProps) {
  return (
    <EmailLayout>
      <Heading style={emailStyles.heading}>Lembrete de lead em andamento</Heading>
      <Text style={emailStyles.paragraph}>
        O lead <strong>{leadName}</strong>
        {companyName ? (
          <>
            {' '}
            ({companyName})
          </>
        ) : null}{' '}
        está <strong>em andamento há {daysInProgress} dias</strong> e aguarda uma nova ação sua.
      </Text>
      <Section style={{ margin: '20px 0' }}>
        <Text style={{ ...emailStyles.paragraph, margin: '8px 0' }}>
          <strong>Empresa:</strong> {companyName ?? 'não informada'}
        </Text>
        <Text style={{ ...emailStyles.paragraph, margin: '8px 0' }}>
          <strong>Dias em andamento:</strong> {daysInProgress}
        </Text>
        <Text style={{ ...emailStyles.paragraph, margin: '8px 0' }}>
          <strong>Última atividade:</strong>{' '}
          {lastActivityLabel ?? 'nenhuma atividade registrada'}
        </Text>
      </Section>
      <Text style={emailStyles.paragraph}>
        Acesse o lead para registrar uma atividade ou atualizar o status:
      </Text>
      <Text style={emailStyles.linkBox}>{leadUrl}</Text>
    </EmailLayout>
  );
}
