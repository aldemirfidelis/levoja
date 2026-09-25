import { Injectable } from '@nestjs/common';
import { AppConfig } from '../../config/config.module';
import { MailService } from '../../infra/mail/mail.service';
import { OneTimeTokenService } from './one-time-token.service';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { TenantsService } from '../tenants/tenants.service';

type Portal = 'web' | 'admin';

/** Convites (definir senha) e links de redefinição de senha enviados por e-mail. */
@Injectable()
export class InvitationsService {
  constructor(
    private readonly tokens: OneTimeTokenService,
    private readonly mail: MailService,
    private readonly config: AppConfig,
    private readonly prisma: PrismaService,
    private readonly tenants: TenantsService,
  ) {}

  /** Endereço do portal e nome da marca do tenant da pessoa (white label). */
  private async portal(userId: string, portal: Portal): Promise<{ url: string; brand: string }> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { tenantId: true } });
    if (!user) return { url: portal === 'admin' ? this.config.env.ADMIN_PUBLIC_URL : this.config.env.WEB_PUBLIC_URL, brand: this.config.env.APP_NAME };
    const tenant = await this.tenants.info(user.tenantId);
    return { url: portal === 'admin' ? tenant.adminUrl : tenant.webUrl, brand: tenant.appName };
  }

  async sendInvitation(user: { id: string; name: string; email: string }, headline: string, portal: Portal): Promise<void> {
    const token = await this.tokens.issueLink(user.id, 'INVITATION', 72 * 60);
    const target = await this.portal(user.id, portal);
    await this.mail.send({
      brand: target.brand,
      to: user.email,
      subject: headline,
      paragraphs: [
        `Olá, ${user.name.split(' ')[0]}!`,
        `${headline}. Para ativar seu acesso, defina sua senha pelo link abaixo. O link é válido por 72 horas.`,
      ],
      action: { label: 'Definir minha senha', url: `${target.url}/definir-senha?token=${encodeURIComponent(token)}` },
      footer: 'Se você não esperava este convite, ignore este e-mail.',
    });
  }

  async sendPasswordReset(user: { id: string; name: string; email: string }, portal: Portal): Promise<void> {
    const token = await this.tokens.issueLink(user.id, 'PASSWORD_RESET', 60);
    const target = await this.portal(user.id, portal);
    await this.mail.send({
      brand: target.brand,
      to: user.email,
      subject: 'Redefinição de senha',
      paragraphs: [
        `Olá, ${user.name.split(' ')[0]}!`,
        'Recebemos uma solicitação para redefinir a senha da sua conta. O link é válido por 1 hora.',
      ],
      action: { label: 'Redefinir senha', url: `${target.url}/redefinir-senha?token=${encodeURIComponent(token)}` },
      footer: 'Se você não fez esta solicitação, ignore este e-mail — sua senha continua a mesma.',
    });
  }
}
