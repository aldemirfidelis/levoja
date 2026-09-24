import { Injectable, Logger } from '@nestjs/common';
import { AppConfig } from '../../config/config.module';

export interface BridgeCallInput {
  /** Quem pediu a ligação: recebe a chamada primeiro. */
  callerPhone: string;
  /** Com quem vai falar: é chamado quando o solicitante atende. */
  calleePhone: string;
  announcement: string;
}

/**
 * Ligação mascarada por ponte: a plataforma liga para quem solicitou e, ao atender, conecta com a
 * outra parte usando o número da plataforma como identificador — ninguém vê o telefone do outro.
 * VOICE_PROVIDER=none desativa o recurso (o chat continua disponível).
 */
@Injectable()
export class VoiceProvider {
  private readonly logger = new Logger(VoiceProvider.name);

  constructor(private readonly config: AppConfig) {}

  get enabled(): boolean {
    return this.config.env.VOICE_PROVIDER === 'twilio';
  }

  get name(): string {
    return this.config.env.VOICE_PROVIDER;
  }

  async bridge(input: BridgeCallInput): Promise<{ providerCallId: string }> {
    const env = this.config.env;
    if (env.VOICE_PROVIDER !== 'twilio') throw new Error('Provedor de voz não configurado.');
    const callerId = env.TWILIO_CALLER_ID!;
    const escape = (value: string) => value.replace(/[<>&"']/g, '');
    const twiml =
      `<Response><Say language="pt-BR">${escape(input.announcement)}</Say>` +
      `<Dial callerId="${escape(callerId)}" timeLimit="600" answerOnBridge="true"><Number>${escape(input.calleePhone)}</Number></Dial></Response>`;
    const body = new URLSearchParams({ To: input.callerPhone, From: callerId, Twiml: twiml });
    const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Calls.json`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
      signal: AbortSignal.timeout(15_000),
    });
    const data = (await response.json().catch(() => ({}))) as { sid?: string; message?: string };
    if (!response.ok || !data.sid) {
      this.logger.error(`Twilio recusou a ligação: HTTP ${response.status} ${data.message ?? ''}`);
      throw new Error('O provedor de voz recusou a ligação.');
    }
    return { providerCallId: data.sid };
  }
}
