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
import { connectUsb, PORTS } from './lib/adb.mjs';

let usb;
try {
  usb = connectUsb();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

for (const { serial, model } of usb.devices) console.log(`✔ ${model} (${serial}): portas redirecionadas`);
for (const [port, label] of PORTS) console.log(`   localhost:${port} no celular → localhost:${port} no notebook (${label})`);

console.log(`
Próximos passos (API, portal e painel já rodando — veja docs/testes-locais.md):
  App do cliente:     pnpm dev:client:usb     (sobe o Metro e abre no Expo Go do celular)
  App do entregador:  pnpm dev:driver:usb
  Build nativo (GPS em segundo plano e push): cd mobile-driver && npx expo run:android --device`);
