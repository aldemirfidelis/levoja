import { Global, Module } from '@nestjs/common';
import { Env, loadEnv } from './env';

export const ENV = Symbol('ENV');

/** Serviço tipado de configuração — única porta de acesso às variáveis de ambiente. */
export class AppConfig {
  constructor(readonly env: Env) {}

  get isProduction(): boolean {
    return this.env.NODE_ENV === 'production';
  }

  get isTest(): boolean {
    return this.env.NODE_ENV === 'test';
  }

  get corsOrigins(): string[] {
    return this.env.CORS_ORIGINS.split(',')
      .map((origin) => origin.trim())
      .filter(Boolean);
  }
}

@Global()
@Module({
  providers: [{ provide: AppConfig, useFactory: () => new AppConfig(loadEnv()) }],
  exports: [AppConfig],
})
export class ConfigModule {}
