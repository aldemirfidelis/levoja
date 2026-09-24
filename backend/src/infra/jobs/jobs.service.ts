import { Inject, Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { Queue, Worker, type JobsOptions } from 'bullmq';
import type Redis from 'ioredis';
import { REDIS } from '../redis/redis.module';
import { AppConfig } from '../../config/config.module';

export type JobHandler<T = unknown> = (payload: T) => Promise<void>;

export interface EnqueueOptions {
  /** Atraso em milissegundos (ex.: expiração de oferta, entrega agendada). */
  delayMs?: number;
  attempts?: number;
  /** Id idempotente: jobs com o mesmo id não são duplicados. */
  jobId?: string;
}

const QUEUE_NAME = 'levoja-jobs';

/**
 * Fila de tarefas assíncronas com uma única interface:
 * - BullMQ (Redis) em staging/produção: persistente, com retentativas e múltiplos workers.
 * - Execução em processo em desenvolvimento/testes (sem Redis).
 *
 * Handlers são registrados por nome pelos módulos (`register`).
 */
@Injectable()
export class JobsService implements OnApplicationShutdown {
  private readonly logger = new Logger(JobsService.name);
  private readonly handlers = new Map<string, JobHandler<any>>();
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private queue?: Queue;
  private worker?: Worker;
  private readonly inline: boolean;

  constructor(
    @Inject(REDIS) redis: Redis | null,
    private readonly config: AppConfig,
  ) {
    this.inline = !redis;
    if (redis) {
      const connection = redis.duplicate();
      this.queue = new Queue(QUEUE_NAME, { connection });
      this.worker = new Worker(
        QUEUE_NAME,
        async (job) => {
          const handler = this.handlers.get(job.name);
          if (!handler) throw new Error(`Nenhum handler para o job "${job.name}"`);
          await handler(job.data);
        },
        { connection: redis.duplicate(), concurrency: 10 },
      );
      this.worker.on('failed', (job, error) =>
        this.logger.error(`Job ${job?.name}#${job?.id} falhou (tentativa ${job?.attemptsMade}): ${error.message}`),
      );
    }
  }

  register<T>(name: string, handler: JobHandler<T>): void {
    this.handlers.set(name, handler as JobHandler<any>);
  }

  async enqueue<T>(name: string, payload: T, options: EnqueueOptions = {}): Promise<void> {
    if (this.queue) {
      const jobOptions: JobsOptions = {
        delay: options.delayMs,
        attempts: options.attempts ?? 3,
        backoff: { type: 'exponential', delay: 2_000 },
        jobId: options.jobId,
        removeOnComplete: 1_000,
        removeOnFail: 5_000,
      };
      await this.queue.add(name, payload, jobOptions);
      return;
    }
    this.runInline(name, payload, options);
  }

  /** Cancela um job agendado (idempotente). */
  async cancel(jobId: string): Promise<void> {
    if (this.queue) {
      const job = await this.queue.getJob(jobId);
      await job?.remove().catch(() => undefined);
      return;
    }
    const timer = this.timers.get(jobId);
    if (timer) clearTimeout(timer);
    this.timers.delete(jobId);
  }

  private runInline<T>(name: string, payload: T, options: EnqueueOptions): void {
    const attempts = options.attempts ?? 3;
    const execute = async (attempt: number): Promise<void> => {
      const handler = this.handlers.get(name);
      if (!handler) {
        this.logger.error(`Nenhum handler para o job "${name}"`);
        return;
      }
      try {
        await handler(payload);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (attempt < attempts && !this.config.isTest) {
          this.logger.warn(`Job ${name} falhou (tentativa ${attempt}): ${message} — nova tentativa`);
          setTimeout(() => void execute(attempt + 1), 2_000 * 2 ** (attempt - 1)).unref();
        } else {
          this.logger.error(`Job ${name} falhou definitivamente: ${message}`);
        }
      }
    };

    if (options.jobId && this.timers.has(options.jobId)) return;
    const timer = setTimeout(() => {
      if (options.jobId) this.timers.delete(options.jobId);
      void execute(1);
    }, options.delayMs ?? 0);
    timer.unref();
    if (options.jobId) this.timers.set(options.jobId, timer);
  }

  get backend(): 'bullmq' | 'inline' {
    return this.inline ? 'inline' : 'bullmq';
  }

  async onApplicationShutdown(): Promise<void> {
    this.timers.forEach((timer) => clearTimeout(timer));
    await this.worker?.close();
    await this.queue?.close();
  }
}
