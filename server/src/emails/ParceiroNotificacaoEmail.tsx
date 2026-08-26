import { Heading, Text, Section } from '@react-email/components';
import { EmailLayout, emailStyles } from './EmailLayout.js';

export function ParceiroNotificacaoEmail({
  titulo,
  linhas,
  ctaUrl,
}: {
  titulo: string;
  linhas: string[];
  ctaUrl?: string;
}) {
  return (
    <EmailLayout>
      <Heading style={emailStyles.heading}>{titulo}</Heading>
      <Section style={{ margin: '20px 0' }}>
        {linhas.map((linha, i) => (
          <Text key={i} style={{ ...emailStyles.paragraph, margin: '8px 0' }}>
            {linha}
          </Text>
        ))}
      </Section>
      {ctaUrl ? <Text style={emailStyles.linkBox}>{ctaUrl}</Text> : null}
    </EmailLayout>
  );
}
