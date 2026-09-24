import { INestApplicationContext } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import type Redis from 'ioredis';
import type { ServerOptions } from 'socket.io';

/**
 * Adapter Socket.IO com Redis (pub/sub): eventos emitidos em uma instância da API
 * chegam aos clientes conectados em qualquer outra — requisito para escalar horizontalmente.
 */
export class RedisIoAdapter extends IoAdapter {
  private readonly adapter: ReturnType<typeof createAdapter>;

  constructor(app: INestApplicationContext, redis: Redis) {
    super(app);
    const pub = redis.duplicate();
    const sub = redis.duplicate();
    this.adapter = createAdapter(pub, sub);
  }

  override createIOServer(port: number, options?: ServerOptions) {
    const server = super.createIOServer(port, options);
    server.adapter(this.adapter);
    return server;
  }
}
