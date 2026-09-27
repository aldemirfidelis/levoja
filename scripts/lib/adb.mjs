/**
 * Celular Android ligado por cabo USB: encontra o adb e redireciona as portas do celular para o notebook.
 * Usado por `pnpm android:usb` e pelos atalhos `pnpm dev:client:usb` / `pnpm dev:driver:usb`.
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export const PORTS = [
  [3333, 'API'],
  [3000, 'portal'],
  [8081, 'Metro — app do cliente'],
  [8082, 'Metro — app do entregador'],
];

export function findAdb() {
  const exe = process.platform === 'win32' ? 'adb.exe' : 'adb';
  const roots = [process.env.ANDROID_HOME, process.env.ANDROID_SDK_ROOT, process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Android', 'Sdk'), process.env.HOME && join(process.env.HOME, 'Android', 'Sdk')];
  for (const root of roots) {
    if (root && existsSync(join(root, 'platform-tools', exe))) return join(root, 'platform-tools', exe);
  }
  try {
    execFileSync(exe, ['version'], { stdio: 'ignore' });
    return exe;
  } catch {
    return null;
  }
}

/**
 * Redireciona as portas (`adb reverse`) em todos os celulares prontos e devolve o adb e os aparelhos.
 * Sem adb, sem celular ou sem autorização de depuração, lança um erro com a orientação para o usuário.
 */
export function connectUsb() {
  const adb = findAdb();
  if (!adb) throw new Error('adb não encontrado. Instale o Android SDK Platform-Tools e defina ANDROID_HOME (ex.: D:\\dev-cache\\Android\\Sdk).');

  const run = (...args) => execFileSync(adb, args, { encoding: 'utf8' }).trim();
  run('start-server');
  const lines = run('devices', '-l')
    .split('\n')
    .slice(1)
    .map((line) => line.trim())
    .filter(Boolean);

  if (!lines.length) {
    throw new Error(`Nenhum celular encontrado pelo adb (${adb}).

1. No celular: Configurações > Sobre o telefone > toque 7 vezes em "Número da versão" (ativa o modo desenvolvedor).
2. Configurações > Sistema > Opções do desenvolvedor > ative "Depuração USB".
3. Conecte o cabo (modo "Transferência de arquivos"), desbloqueie a tela e aceite "Permitir depuração USB".
4. Rode de novo.`);
  }
  if (lines.some((line) => /\bunauthorized\b/.test(line))) {
    throw new Error('O celular está conectado, mas a depuração USB ainda não foi autorizada. Desbloqueie a tela, aceite o aviso "Permitir depuração USB" e rode de novo.');
  }

  const devices = lines
    .filter((line) => /\bdevice\b/.test(line))
    .map((line) => {
      const serial = line.split(/\s+/)[0];
      return { serial, model: (/model:(\S+)/.exec(line)?.[1] ?? serial).replace(/_/g, ' ') };
    });
  for (const { serial } of devices) {
    for (const [port] of PORTS) run('-s', serial, 'reverse', `tcp:${port}`, `tcp:${port}`);
  }
  return { adb, devices };
}
