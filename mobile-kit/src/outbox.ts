import AsyncStorage from '@react-native-async-storage/async-storage';
import { ApiError } from './api';

export interface OutboxItem<T = unknown> {
  id: string;
  kind: string;
  payload: T;
  createdAt: number;
  attempts: number;
  lastError?: string;
}

export interface OutboxStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

export type OutboxHandler = (payload: never) => Promise<void>;

export interface OutboxOptions {
  storage?: OutboxStorage;
  /** Limite de itens guardados (os mais antigos são descartados). */
  maxItems?: number;
  /** Item descartado por erro definitivo (ex.: entrega já cancelada) — para avisar o usuário. */
  onDrop?: (item: OutboxItem, error: unknown) => void;
}

/** Erros que não adianta repetir: validação/regra de negócio (4xx), exceto tempo esgotado e limite de requisições. */
export function isPermanentError(error: unknown): boolean {
  return error instanceof ApiError && !error.offline && error.status >= 400 && error.status < 500 && error.status !== 408 && error.status !== 429;
}

let sequence = 0;
const newId = () => `${Date.now().toString(36)}-${(sequence++).toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/**
 * Fila de saída persistente (tolerância a falta de conexão): ações são gravadas no aparelho e
 * enviadas em ordem (FIFO) quando houver conexão. Sobrevive ao fechamento do app.
 */
export class Outbox {
  private items: OutboxItem[] = [];
  private loaded: Promise<void> | null = null;
  private flushing: Promise<FlushResult> | null = null;
  private readonly listeners = new Set<(items: readonly OutboxItem[]) => void>();
  private readonly storage: OutboxStorage;
  private readonly maxItems: number;

  constructor(
    private readonly key: string,
    private readonly handlers: Record<string, OutboxHandler>,
    private readonly options: OutboxOptions = {},
  ) {
    this.storage = options.storage ?? AsyncStorage;
    this.maxItems = options.maxItems ?? 500;
  }

  private load(): Promise<void> {
    if (!this.loaded) {
      this.loaded = this.storage
        .getItem(this.key)
        .then((raw) => {
          this.items = raw ? (JSON.parse(raw) as OutboxItem[]) : [];
        })
        .catch(() => {
          this.items = [];
        });
    }
    return this.loaded;
  }

  private async persist() {
    await this.storage.setItem(this.key, JSON.stringify(this.items));
    this.listeners.forEach((listener) => listener(this.items));
  }

  /**
   * Enfileira uma ação. `merge` permite agrupar com o último item do mesmo tipo ainda não enviado
   * (ex.: pontos de GPS em lotes) — retorne null para não agrupar.
   */
  async enqueue<T>(kind: string, payload: T, merge?: (pending: T) => T | null): Promise<void> {
    await this.load();
    const last = this.items[this.items.length - 1];
    if (merge && last && last.kind === kind) {
      const merged = merge(last.payload as T);
      if (merged !== null) {
        last.payload = merged;
        await this.persist();
        return;
      }
    }
    this.items.push({ id: newId(), kind, payload, createdAt: Date.now(), attempts: 0 });
    if (this.items.length > this.maxItems) this.items.splice(0, this.items.length - this.maxItems);
    await this.persist();
  }

  /** Envia os itens em ordem; para no primeiro erro temporário (sem conexão, servidor fora). */
  flush(): Promise<FlushResult> {
    if (!this.flushing) {
      this.flushing = this.run().finally(() => {
        this.flushing = null;
      });
    }
    return this.flushing;
  }

  private async run(): Promise<FlushResult> {
    await this.load();
    let sent = 0;
    let dropped = 0;
    while (this.items.length) {
      const item = this.items[0];
      const handler = this.handlers[item.kind];
      try {
        if (!handler) throw new ApiError(400, `Ação desconhecida: ${item.kind}`);
        await handler(item.payload as never);
        this.items.shift();
        sent += 1;
        await this.persist();
      } catch (error) {
        if (isPermanentError(error)) {
          this.items.shift();
          dropped += 1;
          await this.persist();
          this.options.onDrop?.(item, error);
          continue;
        }
        item.attempts += 1;
        item.lastError = error instanceof Error ? error.message : String(error);
        await this.persist();
        return { sent, dropped, remaining: this.items.length, blocked: true };
      }
    }
    return { sent, dropped, remaining: 0, blocked: false };
  }

  async pending(): Promise<readonly OutboxItem[]> {
    await this.load();
    return this.items;
  }

  subscribe(listener: (items: readonly OutboxItem[]) => void): () => void {
    this.listeners.add(listener);
    void this.load().then(() => listener(this.items));
    return () => this.listeners.delete(listener);
  }

  async clear(): Promise<void> {
    await this.load();
    this.items = [];
    await this.persist();
  }
}

export interface FlushResult {
  sent: number;
  dropped: number;
  remaining: number;
  /** Parou por erro temporário (tentar de novo quando a conexão voltar). */
  blocked: boolean;
}
