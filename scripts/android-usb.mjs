#!/usr/bin/env node
/**
 * Prepara um celular Android conectado por cabo USB para testar os apps localmente.
 *
 * Uso:  pnpm android:usb
 *
 * - Encontra o adb (ANDROID_HOME, ANDROID_SDK_ROOT, SDK padrão do Android Studio ou PATH).
 * - Lista os aparelhos e redireciona as portas do celular para o notebook (`adb reverse`):
 *   3333 (API), 3000 (portal: termos, convite, redefinir senha), 8081 (Metro do app do cliente)
 *   e 8082 (Metro do app do entregador). Assim os apps usam http://localhost:3333 no próprio celular.
 * - O redirecionamento vale enquanto o cabo estiver conectado: rode de novo ao reconectar.
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const PORTS = [
  [3333, 'API'],
  [3000, 'portal'],
  [8081, 'Metro — app do cliente'],
  [8082, 'Metro — app do entregador'],
];

function findAdb() {
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

const adb = findAdb();
if (!adb) {
  console.error('adb não encontrado. Instale o Android SDK Platform-Tools e defina ANDROID_HOME (ex.: D:\\dev-cache\\Android\\Sdk).');
  process.exit(1);
}

const run = (...args) => execFileSync(adb, args, { encoding: 'utf8' }).trim();

run('start-server');
const devices = run('devices', '-l')
  .split('\n')
  .slice(1)
  .map((line) => line.trim())
  .filter(Boolean);

if (!devices.length) {
  console.error(`Nenhum celular encontrado pelo adb (${adb}).

1. No celular: Configurações > Sobre o telefone > toque 7 vezes em "Número da versão" (ativa o modo desenvolvedor).
2. Configurações > Sistema > Opções do desenvolvedor > ative "Depuração USB".
3. Conecte o cabo (modo "Transferência de arquivos"), desbloqueie a tela e aceite "Permitir depuração USB".
4. Rode de novo: pnpm android:usb`);
  process.exit(1);
}

const unauthorized = devices.filter((line) => /\bunauthorized\b/.test(line));
if (unauthorized.length) {
  console.error('O celular está conectado, mas a depuração USB ainda não foi autorizada. Desbloqueie a tela, aceite o aviso "Permitir depuração USB" e rode de novo.');
  process.exit(1);
}

const ready = devices.filter((line) => /\bdevice\b/.test(line));
for (const line of ready) {
  const serial = line.split(/\s+/)[0];
  const model = /model:(\S+)/.exec(line)?.[1] ?? serial;
  for (const [port] of PORTS) run('-s', serial, 'reverse', `tcp:${port}`, `tcp:${port}`);
  console.log(`✔ ${model.replace(/_/g, ' ')} (${serial}): portas redirecionadas`);
}
for (const [port, label] of PORTS) console.log(`   localhost:${port} no celular → localhost:${port} no notebook (${label})`);

console.log(`
Próximos passos (API, portal e painel já rodando — veja docs/testes-locais.md):
  App do cliente:     pnpm dev:client            e tecle "a" (abre no Expo Go do celular)
  App do entregador:  cd mobile-driver && npx expo start --port 8082   e tecle "a"
  Build nativo (GPS em segundo plano e push): cd mobile-driver && npx expo run:android --device`);
