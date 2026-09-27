'use client';

/**
 * Toque de "pedido novo" gerado com Web Audio (sem arquivos de som).
 *
 * Os navegadores só liberam áudio depois que a pessoa interage com a página (clique ou tecla).
 * O contexto é criado sob demanda e retomado a cada toque; `unlockOrderChime` deve ser chamado
 * num gesto do usuário para liberar o som logo no primeiro clique.
 */
let context: AudioContext | null = null;

function audioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  try {
    context ??= new Ctor();
  } catch {
    return null;
  }
  return context;
}

/** Libera o áudio (chamar dentro de um clique/tecla). */
export function unlockOrderChime() {
  const ctx = audioContext();
  if (ctx?.state === 'suspended') void ctx.resume().catch(() => undefined);
}

/** O navegador já permite tocar som nesta página? */
export function orderChimeAllowed(): boolean {
  if (context?.state === 'running') return true;
  const activation = (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation;
  return activation ? activation.hasBeenActive : true;
}

/** Arpejo ascendente (Lá maior) tocado duas vezes: curto, audível numa cozinha e fácil de reconhecer. */
function schedule(ctx: AudioContext, volume: number) {
  const notes = [880, 1108.73, 1318.51];
  const start = ctx.currentTime + 0.02;
  for (let round = 0; round < 2; round++) {
    notes.forEach((frequency, index) => {
      const at = start + round * 0.62 + index * 0.13;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(volume, at + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.45);
      gain.connect(ctx.destination);
      const oscillator = ctx.createOscillator();
      oscillator.type = 'triangle';
      oscillator.frequency.value = frequency;
      oscillator.connect(gain);
      oscillator.start(at);
      oscillator.stop(at + 0.5);
    });
  }
}

export function playOrderChime(volume = 0.35) {
  const ctx = audioContext();
  if (!ctx) return;
  if (ctx.state === 'running') return schedule(ctx, volume);
  void ctx
    .resume()
    .then(() => ctx.state === 'running' && schedule(ctx, volume))
    .catch(() => undefined);
}
