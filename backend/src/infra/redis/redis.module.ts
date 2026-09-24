import { Global, Logger, Module, OnApplicationShutdown, Inject, Optional } from '@nestjs/common';
import Redis from 'ioredis';
import { AppConfig } from '../../config/config.module';

export const REDIS = Symbol('REDIS');

/**
 * Conexão Redis compartilhada. É opcional: sem REDIS_URL o provider resolve `null`
 * e cache/filas/tempo real usam implementações em memória (adequadas apenas para
 * uma única instância em desenvolvimento).
 */
@Global()
@Module({
  providers: [
    {
      provide: REDIS,
      inject: [AppConfig],
      useFactory: (config: AppConfig): Redis | null => {
        if (!config.env.REDIS_URL) {
          new Logger('Redis').warn('REDIS_URL não definido — usando cache/filas em memória (somente desenvolvimento).');
          return null;
        }
        return new Redis(config.env.REDIS_URL, { maxRetriesPerRequest: null, lazyConnect: false });
      },
    },
  ],
  exports: [REDIS],
})
export class RedisModule implements OnApplicationShutdown {
  constructor(@Optional() @Inject(REDIS) private readonly redis: Redis | null) {}

  async onApplicationShutdown(): Promise<void> {
    await this.redis?.quit().catch(() => undefined);
  }
}
