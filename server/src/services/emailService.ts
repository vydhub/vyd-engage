import { Resend } from 'resend';
import { createElement } from 'react';
import { render } from '@react-email/render';
import { logger } from '../utils/logger.js';
import { PasswordResetEmail } from '../emails/PasswordResetEmail.js';
import { EmailVerificationEmail } from '../emails/EmailVerificationEmail.js';
import { InvitationEmail } from '../emails/InvitationEmail.js';
import { AtestadoPendenciaEmail, type PendenciaLine } from '../emails/AtestadoPendenciaEmail.js';
import { ParceiroNotificacaoEmail } from '../emails/ParceiroNotificacaoEmail.js';

// Resend client initialization
let resendClient: Resend | null = null;

function getResendClient(): Resend {
  if (resendClient) {
    return resendClient;
  }

  const apiKey = process.env.RESEND_API_KEY;

  if (!apiKey) {
    throw new Error(
      'RESEND_API_KEY is not configured. Please set it in your environment variables.'
    );
  }

  resendClient = new Resend(apiKey);
  return resendClient;
}

export interface EmailOptions {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  from?: string;
}

export async function sendEmail(options: EmailOptions): Promise<void> {
  try {
    const resend = getResendClient();

    // Resend requires verified domain or uses onboarding@resend.dev for testing
    // Format: "Name <email@domain.com>" or just "email@domain.com"
    const fromEmail = options.from || process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev';

    // Resend accepts array of recipients
    const recipients = Array.isArray(options.to) ? options.to : [options.to];

    // Extract text from HTML if not provided
    const textContent = options.text || options.html.replace(/<[^>]*>/g, '');

    const { data, error } = await resend.emails.send({
      from: fromEmail,
      to: recipients,
      subject: options.subject,
      html: options.html,
      text: textContent,
    } as any);

    if (error) {
      logger.error('Resend API error', error);
      logger.error('Resend error details', {
        name: error.name,
        message: error.message,
        statusCode: (error as any).statusCode,
        fullError: JSON.stringify(error, null, 2),
      });
      throw new Error(`Failed to send email: ${error.message || 'Unknown error'}`);
    }

    logger.info('Email sent successfully', {
      messageId: data?.id,
      to: options.to,
      subject: options.subject,
      from: fromEmail,
    });
  } catch (error: any) {
    logger.error('Error sending email', error);
    throw new Error(`Failed to send email: ${error.message}`, { cause: error });
  }
}

// Email templates — rendered from typed react-email components (server-side).
// Each returns a Promise<{ subject, html }> (render is async), so call sites await.
export const emailTemplates = {
  async passwordReset(name: string, resetLink: string) {
    return {
      subject: 'Recuperação de Senha - VYD Engage',
      html: await render(createElement(PasswordResetEmail, { name, resetLink })),
    };
  },

  async emailVerification(name: string, verificationLink: string) {
    return {
      subject: 'Verifique seu Email - VYD Engage',
      html: await render(createElement(EmailVerificationEmail, { name, verificationLink })),
    };
  },

  async invitation(inviterName: string, companyName: string, invitationLink: string, role: string) {
    return {
      subject: `Convite para ${companyName} - VYD Engage`,
      html: await render(
        createElement(InvitationEmail, { inviterName, companyName, invitationLink, role })
      ),
    };
  },

  async atestadoPendencias(pendencias: PendenciaLine[], appUrl: string) {
    return {
      subject: `Atestados pendentes (${pendencias.length}) - VYD Engage`,
      html: await render(createElement(AtestadoPendenciaEmail, { pendencias, appUrl })),
    };
  },

  async parceiroNotificacao(titulo: string, linhas: string[], ctaUrl?: string) {
    return {
      subject: `${titulo} - VYD Engage`,
      html: await render(createElement(ParceiroNotificacaoEmail, { titulo, linhas, ctaUrl })),
    };
  },
};
