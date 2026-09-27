#!/usr/bin/env node
/**
 * Sobe o Metro de um app e abre no Expo Go do celular ligado por cabo USB.
 *
 * Uso:  pnpm dev:client:usb   |   pnpm dev:driver:usb   (argumentos extras vão para o `expo start`, ex.: --clear)
 *
 * - Redireciona as portas pelo cabo (o mesmo que `pnpm android:usb`).
 * - Sobe o Metro com REACT_NATIVE_PACKAGER_HOSTNAME=127.0.0.1, então o Expo Go recebe exp://127.0.0.1:<porta>,
 *   que passa pelo cabo. Sem isso o Expo Go usa o IP do Wi-Fi do notebook (bloqueado pelo firewall), e
 *   `--localhost` não serve: no Windows o Metro passa a escutar só em ::1, e o `adb reverse` entrega em 127.0.0.1.
 * - Monta o bundle Android antes de abrir o app: a primeira montagem leva minutos, e o Expo Go ficaria
 *   parado na tela de abertura enquanto isso.
 */
import { execFileSync, spawn } from 'node:child_process';
import http from 'node:http';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { connectUsb } from './lib/adb.mjs';

const APPS = {
  client: { dir: 'mobile-client', port: 8081, label: 'App do cliente' },
  driver: { dir: 'mobile-driver', port: 8082, label: 'App do entregador' },
};
const HOST = '127.0.0.1';

const [name, ...expoArgs] = process.argv.slice(2);
const app = APPS[name];
if (!app) {
  console.error('Uso: node scripts/expo-usb.mjs <client|driver> [argumentos do expo start]');
  process.exit(1);
}

let usb;
try {
  usb = connectUsb();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
console.log(`✔ Portas redirecionadas pelo cabo: ${usb.devices.map((d) => d.model).join(', ')}`);

const appDir = join(dirname(fileURLToPath(import.meta.url)), '..', app.dir);
const expoCli = createRequire(join(appDir, 'package.json')).resolve('expo/bin/cli');
const metro = spawn(process.execPath, [expoCli, 'start', '--port', String(app.port), ...expoArgs], {
  cwd: appDir,
  stdio: 'inherit',
  env: { ...process.env, REACT_NATIVE_PACKAGER_HOSTNAME: HOST },
});
metro.on('exit', (code) => process.exit(code ?? 0));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => metro.kill(signal));

/** GET sem limite de tempo (a primeira montagem do bundle passa dos 5 min do `fetch`); descarta o corpo. */
function get(url, headers = {}) {
  return new Promise((resolve, reject) => {
    http
      .get(url, { headers }, (res) => {
        const chunks = [];
        let size = 0;
        res.on('data', (chunk) => {
          size += chunk.length;
          if (size < 1_000_000) chunks.push(chunk);
        });
        res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
        res.on('error', reject);
      })
      .on('error', reject);
  });
}

async function openOnPhone() {
  const base = `http://${HOST}:${app.port}`;
  for (;;) {
    const status = await get(`${base}/status`).catch(() => null);
    if (status?.body.includes('packager-status:running')) break;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  const manifest = await get(base, { 'expo-platform': 'android', accept: 'application/expo+json,application/json' });
  const bundleUrl = JSON.parse(manifest.body).launchAsset.url;
  console.log(`\n⏳ ${app.label}: montando o bundle Android (na primeira vez leva alguns minutos)…`);
  const bundle = await get(bundleUrl);
  if (bundle.status !== 200) {
    console.error(`\n✖ O Metro não conseguiu montar o app (HTTP ${bundle.status}). Veja o erro acima; se for "Failed to construct transformer", pare com Ctrl+C e rode de novo.`);
    return;
  }

  for (const { serial, model } of usb.devices) {
    try {
      execFileSync(usb.adb, ['-s', serial, 'shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', `exp://${HOST}:${app.port}`, 'host.exp.exponent'], { stdio: 'ignore' });
      console.log(`\n✔ ${app.label} aberto no Expo Go (${model}) — exp://${HOST}:${app.port}`);
    } catch {
      console.error(`\n✖ Não consegui abrir o Expo Go em ${model}. Confira se ele está instalado (Play Store, versão para o SDK 57).`);
    }
  }
}

openOnPhone().catch((error) => console.error(`\n✖ ${app.label}: ${error.message}`));
