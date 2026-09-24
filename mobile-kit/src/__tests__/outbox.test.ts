import { ApiError } from '../api';
import { Outbox, type OutboxStorage } from '../outbox';

jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn(), setItem: jest.fn() }));

function memoryStorage(): OutboxStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: async (key) => data.get(key) ?? null, setItem: async (key, value) => void data.set(key, value) };
}

describe('Outbox (fila offline)', () => {
  it('envia em ordem e para no primeiro erro temporário', async () => {
    const storage = memoryStorage();
    const sent: string[] = [];
    let online = false;
    const outbox = new Outbox('q', {
      action: async (payload: { name: string }) => {
        if (!online) throw new ApiError(0, 'sem conexão', undefined, undefined, true);
        sent.push(payload.name);
      },
    }, { storage });
    await outbox.enqueue('action', { name: 'coletou' });
    await outbox.enqueue('action', { name: 'a caminho' });

    const offline = await outbox.flush();
    expect(offline).toMatchObject({ sent: 0, remaining: 2, blocked: true });
    expect((await outbox.pending())[0].attempts).toBe(1);

    online = true;
    const result = await outbox.flush();
    expect(result).toMatchObject({ sent: 2, remaining: 0, blocked: false });
    expect(sent).toEqual(['coletou', 'a caminho']);
  });

  it('sobrevive ao reinício do app (persistência)', async () => {
    const storage = memoryStorage();
    const first = new Outbox('q', { action: async () => undefined }, { storage });
    await first.enqueue('action', { id: 1 });
    const second = new Outbox('q', { action: async () => undefined }, { storage });
    expect(await second.pending()).toHaveLength(1);
    await second.flush();
    expect(await second.pending()).toHaveLength(0);
  });

  it('descarta erros definitivos (regra de negócio) e avisa', async () => {
    const storage = memoryStorage();
    const dropped: string[] = [];
    const outbox = new Outbox(
      'q',
      {
        action: async (payload: { name: string }) => {
          if (payload.name === 'cancelada') throw new ApiError(409, 'A entrega foi cancelada.');
        },
      },
      { storage, onDrop: (item, error) => dropped.push(`${(item.payload as { name: string }).name}: ${(error as Error).message}`) },
    );
    await outbox.enqueue('action', { name: 'cancelada' });
    await outbox.enqueue('action', { name: 'ok' });
    expect(await outbox.flush()).toMatchObject({ sent: 1, dropped: 1, remaining: 0 });
    expect(dropped).toEqual(['cancelada: A entrega foi cancelada.']);
  });

  it('agrupa pontos de GPS no mesmo lote e respeita o limite', async () => {
    const storage = memoryStorage();
    const batches: number[] = [];
    const outbox = new Outbox('q', { points: async (payload: number[]) => void batches.push(payload.length) }, { storage });
    const merge = (next: number[]) => (pending: number[]) => (pending.length + next.length <= 3 ? [...pending, ...next] : null);
    for (let i = 0; i < 5; i++) await outbox.enqueue('points', [i], merge([i]));
    expect((await outbox.pending()).length).toBe(2);
    await outbox.flush();
    expect(batches).toEqual([3, 2]);
  });

  it('limita o tamanho da fila descartando os mais antigos', async () => {
    const storage = memoryStorage();
    const outbox = new Outbox('q', { action: async () => undefined }, { storage, maxItems: 3 });
    for (let i = 0; i < 5; i++) await outbox.enqueue('action', { i });
    const pending = await outbox.pending();
    expect(pending.map((item) => (item.payload as { i: number }).i)).toEqual([2, 3, 4]);
  });
});
