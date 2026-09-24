import { Injectable } from '@nestjs/common';
import type { Namespace } from 'socket.io';

/** Emissão de eventos em tempo real para salas (usuário, empresa, entregador, operação). */
@Injectable()
export class RealtimeService {
  private server?: Namespace;

  attach(server: Namespace): void {
    this.server = server;
  }

  toUser(userId: string, event: string, payload: unknown): void {
    this.server?.to(`user:${userId}`).emit(event, payload);
  }

  toCompany(companyId: string, event: string, payload: unknown): void {
    this.server?.to(`company:${companyId}`).emit(event, payload);
  }

  toDriver(driverId: string, event: string, payload: unknown): void {
    this.server?.to(`driver:${driverId}`).emit(event, payload);
  }

  toOps(tenantId: string, event: string, payload: unknown): void {
    this.server?.to(`ops:${tenantId}`).emit(event, payload);
  }

  /** Equipe de atendimento (quem pode ver chamados). */
  toSupport(tenantId: string, event: string, payload: unknown): void {
    this.server?.to(`support:${tenantId}`).emit(event, payload);
  }

  toRoom(room: string, event: string, payload: unknown): void {
    this.server?.to(room).emit(event, payload);
  }
}
