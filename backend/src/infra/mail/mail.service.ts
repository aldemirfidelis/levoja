import { Injectable, Logger } from '@nestjs/common';
import nodemailer, { type Transporter } from 'nodemailer';
import { AppConfig } from '../../config/config.module';

export interface MailMessage {
  to: string;
  subject: string;
  /** Parágrafos do corpo (texto simples, escapado no HTML). */
  paragraphs: string[];
  action?: { label: string; url: string };
  footer?: string;
}

/**
 * Envio de e-mail transacional.
 * - MAIL_DRIVER=smtp: qualquer SMTP (SES, SendGrid, Mailgun, Mailpit em dev).
 * - MAIL_DRIVER=log : registra o e-mail no log (desenvolvimento sem SMTP).
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly transporter?: Transporter;
  /** Últimas mensagens enviadas pelo driver "log" — usado por testes automatizados. */
  readonly outbox: (MailMessage & { sentAt: Date })[] = [];

  constructor(private readonly config: AppConfig) {
    const env = config.env;
    if (env.MAIL_DRIVER === 'smtp') {
      this.transporter = nodemailer.createTransport({
        host: env.SMTP_HOST,
        port: env.SMTP_PORT,
        secure: env.SMTP_SECURE,
        auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } : undefined,
      });
    }
  }

  async send(message: MailMessage): Promise<void> {
    const html = renderHtml(this.config.env.APP_NAME, message);
    const text = renderText(message);

    if (!this.transporter) {
      this.outbox.push({ ...message, sentAt: new Date() });
      if (this.outbox.length > 100) this.outbox.shift();
      if (!this.config.isTest) {
        this.logger.log(`[e-mail simulado] para=${message.to} assunto="${message.subject}"\n${text}`);
      }
      return;
    }

    await this.transporter.sendMail({ from: this.config.env.MAIL_FROM, to: message.to, subject: message.subject, html, text });
  }
}

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);

function renderText(message: MailMessage): string {
  const parts = [...message.paragraphs];
  if (message.action) parts.push(`${message.action.label}: ${message.action.url}`);
  if (message.footer) parts.push(message.footer);
  return parts.join('\n\n');
}

function renderHtml(appName: string, message: MailMessage): string {
  const paragraphs = message.paragraphs
    .map((p) => `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#1f2937">${escapeHtml(p)}</p>`)
    .join('');
  const action = message.action
    ? `<p style="margin:24px 0"><a href="${escapeHtml(message.action.url)}" style="background:#ff5a1f;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block">${escapeHtml(message.action.label)}</a></p>`
    : '';
  const footer = message.footer
    ? `<p style="margin:24px 0 0;font-size:12px;color:#6b7280">${escapeHtml(message.footer)}</p>`
    : '';
  return `<!doctype html><html lang="pt-BR"><body style="margin:0;background:#f3f4f6;font-family:Segoe UI,Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border-radius:12px;padding:32px">
<tr><td><p style="margin:0 0 24px;font-size:20px;font-weight:700;color:#ff5a1f">${escapeHtml(appName)}</p>
<h1 style="margin:0 0 16px;font-size:20px;color:#111827">${escapeHtml(message.subject)}</h1>
${paragraphs}${action}${footer}</td></tr></table></td></tr></table></body></html>`;
}
