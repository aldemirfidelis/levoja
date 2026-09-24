import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { OnGatewayConnection, OnGatewayInit, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import type { Namespace, Socket } from 'socket.io';
import { AccessService } from '../access/access.service';
import type { AccessTokenPayload } from '../../common/guards/jwt-auth.guard';
import { RealtimeService } from './realtime.service';

export interface SocketTicketPayload {
  sub: string;
  typ: 'ws';
}

/**
 * Canal em tempo real (Socket.IO, namespace /realtime).
 * Autenticação no handshake: `auth.token` com um access token (apps) ou um ticket de socket
 * de 60 s (web, emitido por POST /v1/realtime/ticket — o navegador nunca recebe os tokens de sessão).
 *
 * Salas: user:<id>, company:<id>, driver:<id>, ops:<tenantId>.
 */
@WebSocketGateway({ namespace: '/realtime', cors: { origin: true, credentials: true }, transports: ['websocket', 'polling'] })
export class RealtimeGateway implements OnGatewayInit, OnGatewayConnection {
  private readonly logger = new Logger(RealtimeGateway.name);
  @WebSocketServer() server!: Namespace;

  constructor(
    private readonly jwt: JwtService,
    private readonly access: AccessService,
    private readonly realtime: RealtimeService,
  ) {}

  afterInit(server: Namespace): void {
    this.realtime.attach(server);
  }

  async handleConnection(client: Socket): Promise<void> {
    try {
      const token = (client.handshake.auth?.token as string | undefined) ?? client.handshake.headers.authorization?.replace(/^Bearer /i, '');
      if (!token) throw new Error('sem token');
      const payload = await this.jwt.verifyAsync<AccessTokenPayload | SocketTicketPayload>(token);
      if (payload.typ !== 'access' && payload.typ !== 'ws') throw new Error('token inválido');
      const profile = await this.access.getProfile(payload.sub);
      if (!profile || profile.status !== 'ACTIVE') throw new Error('conta indisponível');

      client.data.userId = profile.userId;
      client.data.tenantId = profile.tenantId;
      const rooms = [`user:${profile.userId}`];
      for (const membership of profile.companies) {
        if (membership.permissions.includes('company.orders.read')) rooms.push(`company:${membership.companyId}`);
      }
      if (profile.driverId) rooms.push(`driver:${profile.driverId}`);
      if (profile.permissions.includes('operations.view')) rooms.push(`ops:${profile.tenantId}`);
      await client.join(rooms);
      client.emit('ready', { rooms: rooms.length });
    } catch (error) {
      client.emit('error', { message: 'Não autorizado.' });
      client.disconnect(true);
      this.logger.debug(`Conexão recusada: ${(error as Error).message}`);
    }
  }
}
