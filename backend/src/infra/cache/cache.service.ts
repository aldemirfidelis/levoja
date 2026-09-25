import { Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS } from '../redis/redis.module';

interface MemoryEntry {
  value: string;
  expiresAt: number;
}

/**
 * Cache chave/valor com TTL. Usa Redis quando disponível; caso contrário, memória local.
 * Valores são serializados em JSON.
 */
@Injectable()
export class CacheService {
  private readonly memory = new Map<string, MemoryEntry>();
  private readonly prefix = 'levoja:cache:';

  constructor(@Inject(REDIS) private readonly redis: Redis | null) {}

  async get<T>(key: string): Promise<T | undefined> {
    const raw = this.redis ? await this.redis.get(this.prefix + key) : this.memoryGet(key);
    return raw == null ? undefined : (JSON.parse(raw) as T);
  }

  async set(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    const raw = JSON.stringify(value);
    if (this.redis) {
      await this.redis.set(this.prefix + key, raw, 'EX', ttlSeconds);
      return;
    }
    this.memory.set(key, { value: raw, expiresAt: Date.now() + ttlSeconds * 1000 });
  }

  async del(...keys: string[]): Promise<void> {
    if (keys.length === 0) return;
    if (this.redis) {
      await this.redis.del(...keys.map((key) => this.prefix + key));
      return;
    }
    keys.forEach((key) => this.memory.delete(key));
  }

  /** Remove todas as chaves com o prefixo informado. */
  async delByPrefix(prefix: string): Promise<void> {
    if (this.redis) {
      let cursor = '0';
      do {
        const [next, keys] = await this.redis.scan(cursor, 'MATCH', `${this.prefix}${prefix}*`, 'COUNT', 200);
        cursor = next;
        if (keys.length) await this.redis.del(...keys);
      } while (cursor !== '0');
      return;
    }
    for (const key of this.memory.keys()) if (key.startsWith(prefix)) this.memory.delete(key);
  }

  /**
   * Contador atômico com expiração (ex.: limite de chamadas por minuto). A expiração é definida
   * na primeira incrementação da janela. Com várias instâncias, só é global com Redis.
   */
  async increment(key: string, ttlSeconds: number): Promise<number> {
    if (this.redis) {
      const full = this.prefix + key;
      const [[, count]] = (await this.redis.multi().incr(full).expire(full, ttlSeconds, 'NX').exec()) as [[Error | null, number]];
      return count;
    }
    const current = this.memoryGet(key);
    const next = (current ? Number(JSON.parse(current)) : 0) + 1;
    const entry = this.memory.get(key);
    this.memory.set(key, { value: JSON.stringify(next), expiresAt: entry && current ? entry.expiresAt : Date.now() + ttlSeconds * 1000 });
    return next;
  }

  async wrap<T>(key: string, ttlSeconds: number, factory: () => Promise<T>): Promise<T> {
    const cached = await this.get<T>(key);
    if (cached !== undefined) return cached;
    const value = await factory();
    await this.set(key, value, ttlSeconds);
    return value;
  }

  async ping(): Promise<boolean> {
    if (!this.redis) return true;
    try {
      return (await this.redis.ping()) === 'PONG';
    } catch {
      return false;
    }
  }

  get backend(): 'redis' | 'memory' {
    return this.redis ? 'redis' : 'memory';
  }

  private memoryGet(key: string): string | null {
    const entry = this.memory.get(key);
    if (!entry) return null;
    if (entry.expiresAt < Date.now()) {
      this.memory.delete(key);
      return null;
    }
    return entry.value;
  }
}
