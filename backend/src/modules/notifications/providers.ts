import { Injectable, Logger } from '@nestjs/common';
import { AppConfig } from '../../config/config.module';

export interface PushMessage {
  tokens: string[];
  title: string;
  body: string;
  data?: Record<string, unknown>;
  /** Canal Android (ex.: "offers" com alta prioridade e som próprio no app do entregador). */
  channelId?: string;
  /** Validade em segundos (ofertas expiram — não faz sentido entregar depois). */
  ttlSeconds?: number;
}

export interface PushResult {
  /** Tokens rejeitados pelo provedor (app desinstalado) — devem ser removidos. */
  invalidTokens: string[];
}

/**
 * Push via Expo Push Service (funciona para Android e iOS com Expo Notifications).
 * PUSH_DRIVER=log apenas registra as mensagens (desenvolvimento).
 */
@Injectable()
export class PushProvider {
  private readonly logger = new Logger('Push');
  readonly sent: PushMessage[] = [];

  constructor(private readonly config: AppConfig) {}

  async send(message: PushMessage): Promise<PushResult> {
    if (!message.tokens.length) return { invalidTokens: [] };
    if (this.config.env.PUSH_DRIVER === 'log') {
      this.sent.push(message);
      if (this.sent.length > 100) this.sent.shift();
      if (!this.config.isTest) this.logger.log(`[push simulado] ${message.title} → ${message.tokens.length} dispositivo(s)`);
      return { invalidTokens: [] };
    }

    const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json' };
    if (this.config.env.EXPO_ACCESS_TOKEN) headers.Authorization = `Bearer ${this.config.env.EXPO_ACCESS_TOKEN}`;
    const invalidTokens: string[] = [];

    // A API da Expo aceita até 100 mensagens por requisição.
    for (let i = 0; i < message.tokens.length; i += 100) {
      const batch = message.tokens.slice(i, i + 100);
      const response = await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers,
        body: JSON.stringify(
          batch.map((to) => ({
            to,
            title: message.title,
            body: message.body,
            data: message.data,
            sound: 'default',
            priority: 'high',
            ...(message.channelId ? { channelId: message.channelId } : {}),
            ...(message.ttlSeconds ? { ttl: message.ttlSeconds } : {}),
          })),
        ),
      });
      if (!response.ok) {
        this.logger.error(`Expo push falhou: HTTP ${response.status}`);
        continue;
      }
      const result = (await response.json()) as { data?: { status: string; details?: { error?: string } }[] };
      result.data?.forEach((ticket, index) => {
        if (ticket.status === 'error' && ticket.details?.error === 'DeviceNotRegistered') invalidTokens.push(batch[index]);
      });
    }
    return { invalidTokens };
  }
}

export interface SmsMessage {
  to: string;
  body: string;
  channel: 'sms' | 'whatsapp';
}

/**
 * SMS/WhatsApp. A implementação "log" é usada até que um provedor
 * (ex.: Twilio, Zenvia, WhatsApp Business API) seja contratado — basta
 * implementar `send` com a API escolhida.
 */
@Injectable()
export class SmsProvider {
  private readonly logger = new Logger('SMS');
  readonly sent: SmsMessage[] = [];

  constructor(private readonly config: AppConfig) {}

  async send(message: SmsMessage): Promise<void> {
    this.sent.push(message);
    if (this.sent.length > 100) this.sent.shift();
    if (!this.config.isTest) this.logger.log(`[${message.channel} simulado] para=${message.to}: ${message.body}`);
  }
}
