import { Injectable } from '@nestjs/common';
import { AppConfig } from '../../config/config.module';
import { MailService } from '../../infra/mail/mail.service';
import { OneTimeTokenService } from './one-time-token.service';

type Portal = 'web' | 'admin';

/** Convites (definir senha) e links de redefinição de senha enviados por e-mail. */
@Injectable()
export class InvitationsService {
  constructor(
    private readonly tokens: OneTimeTokenService,
    private readonly mail: MailService,
    private readonly config: AppConfig,
  ) {}

  private portalUrl(portal: Portal): string {
    return portal === 'admin' ? this.config.env.ADMIN_PUBLIC_URL : this.config.env.WEB_PUBLIC_URL;
  }

  async sendInvitation(user: { id: string; name: string; email: string }, headline: string, portal: Portal): Promise<void> {
    const token = await this.tokens.issueLink(user.id, 'INVITATION', 72 * 60);
    await this.mail.send({
      to: user.email,
      subject: headline,
      paragraphs: [
        `Olá, ${user.name.split(' ')[0]}!`,
        `${headline}. Para ativar seu acesso, defina sua senha pelo link abaixo. O link é válido por 72 horas.`,
      ],
      action: { label: 'Definir minha senha', url: `${this.portalUrl(portal)}/definir-senha?token=${encodeURIComponent(token)}` },
      footer: 'Se você não esperava este convite, ignore este e-mail.',
    });
  }

  async sendPasswordReset(user: { id: string; name: string; email: string }, portal: Portal): Promise<void> {
    const token = await this.tokens.issueLink(user.id, 'PASSWORD_RESET', 60);
    await this.mail.send({
      to: user.email,
      subject: 'Redefinição de senha',
      paragraphs: [
        `Olá, ${user.name.split(' ')[0]}!`,
        'Recebemos uma solicitação para redefinir a senha da sua conta. O link é válido por 1 hora.',
      ],
      action: { label: 'Redefinir senha', url: `${this.portalUrl(portal)}/redefinir-senha?token=${encodeURIComponent(token)}` },
      footer: 'Se você não fez esta solicitação, ignore este e-mail — sua senha continua a mesma.',
    });
  }
}
