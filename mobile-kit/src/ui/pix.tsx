import { useEffect, useState } from 'react';
import { View } from 'react-native';
import QRCode from 'react-qr-code';
import * as Clipboard from 'expo-clipboard';
import { formatBRL } from '@levoja/shared';
import { radius, space, useColors } from '../theme';
import { Button, Stack, Text } from './primitives';
import { useToast } from './feedback';

/** Contagem regressiva até uma data (ofertas, PIX). */
export function useCountdown(until: string | Date | null | undefined) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!until) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [until]);
  if (!until) return null;
  const seconds = Math.max(0, Math.floor((new Date(until).getTime() - now) / 1000));
  return { seconds, label: `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`, expired: seconds === 0 };
}

/** Cobrança PIX: QR Code (para pagar de outro aparelho), "copia e cola" e validade. */
export function PixCharge({ copyPaste, expiresAt, amountCents }: { copyPaste: string; expiresAt: string | null; amountCents: number }) {
  const colors = useColors();
  const toast = useToast();
  const countdown = useCountdown(expiresAt);
  const expired = !!countdown?.expired;
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    await Clipboard.setStringAsync(copyPaste);
    setCopied(true);
    toast.success('Código PIX copiado. Cole no app do seu banco.');
    setTimeout(() => setCopied(false), 3000);
  };

  return (
    <Stack gap={4} style={{ alignItems: 'center' }}>
      <Text variant="display" style={{ fontVariant: ['tabular-nums'] }}>
        {formatBRL(amountCents)}
      </Text>
      <View style={{ padding: space(3), backgroundColor: '#ffffff', borderRadius: radius.md, opacity: expired ? 0.25 : 1 }} accessibilityLabel="QR Code do PIX">
        <QRCode value={copyPaste} size={200} />
      </View>
      {countdown ? (
        <Text tone={expired ? 'danger' : 'muted'} accessibilityLiveRegion="polite">
          {expired ? 'Este PIX expirou.' : `Pague em até ${countdown.label}`}
        </Text>
      ) : null}
      <Button title={copied ? 'Copiado!' : 'Copiar código PIX'} icon={copied ? 'check' : 'copy'} onPress={copy} disabled={expired} fullWidth />
      <View style={{ backgroundColor: colors.surface2, borderRadius: radius.md, padding: space(3), alignSelf: 'stretch', gap: space(1) }}>
        <Text variant="label">Como pagar</Text>
        <Text variant="caption" tone="muted">
          1. Copie o código acima.{'\n'}2. Abra o app do seu banco e escolha PIX Copia e Cola.{'\n'}3. Cole o código e confirme. A confirmação aqui é automática.
        </Text>
      </View>
    </Stack>
  );
}
