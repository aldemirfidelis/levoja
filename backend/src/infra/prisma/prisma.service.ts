import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client';
import { AppConfig } from '../../config/config.module';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor(config: AppConfig) {
    super({ adapter: new PrismaPg({ connectionString: config.env.DATABASE_URL }) });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('Conectado ao PostgreSQL');
    // Textos com emoji e outros símbolos exigem banco em UTF-8 (bancos WIN1252/LATIN1 recusam esses caracteres).
    const [row] = await this.$queryRaw<{ encoding: string }[]>`SELECT pg_encoding_to_char(encoding) AS encoding FROM pg_database WHERE datname = current_database()`;
    if (row && row.encoding !== 'UTF8') {
      this.logger.warn(`O banco usa a codificação ${row.encoding}: textos com emoji ou símbolos fora dessa tabela serão recusados. Crie o banco com ENCODING 'UTF8' (veja o README).`);
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  async ping(): Promise<boolean> {
    try {
      await this.$queryRaw`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }
}

/** Cliente transacional (dentro de $transaction) ou o cliente raiz. */
export type Tx = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$extends'
>;
