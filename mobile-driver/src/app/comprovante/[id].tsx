import { useRef, useState } from 'react';
import { Image, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import { Directory, File, Paths } from 'expo-file-system';
import { PROOF_METHOD_LABELS } from '@levoja/shared';
import { Button, Checkbox, ErrorView, errorMessage, Field, Loading, radius, Row, Screen, Segmented, space, Stack, Text, useColors, useToast } from '@levoja/mobile-kit';
import { SignaturePad, type SignaturePadHandle } from '@/components/signature-pad';
import { usePersistentApi } from '@/lib/cache';
import { useDriver } from '@/lib/driver';
import type { DeliverPayload } from '@/lib/outbox';
import type { DriverDelivery } from '@/lib/types';

/** Copia o arquivo para a pasta do app: se a entrega for concluída sem internet, a prova não se perde. */
function persist(uri: string, name: string): string {
  const directory = new Directory(Paths.document, 'comprovantes');
  if (!directory.exists) directory.create({ intermediates: true });
  const target = new File(directory, name);
  if (target.exists) target.delete();
  new File(uri).copy(target);
  return target.uri;
}

export default function ProofScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const colors = useColors();
  const toast = useToast();
  const driver = useDriver();
  const delivery = usePersistentApi<DriverDelivery>(`drivers/me/deliveries/${id}`);
  const [mode, setMode] = useState<'code' | 'qr'>('code');
  const [code, setCode] = useState('');
  const [photo, setPhoto] = useState<string | null>(null);
  const [recipientName, setRecipientName] = useState('');
  const [idChecked, setIdChecked] = useState(false);
  const [hasInk, setHasInk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const scanned = useRef(false);
  const signature = useRef<SignaturePadHandle>(null);

  if (delivery.isLoading && !delivery.data) return <Loading />;
  if (!delivery.data) return <ErrorView error={delivery.error} onRetry={() => delivery.refetch()} />;
  const data = delivery.data;
  const byCode = data.proofMethod === 'CODE' || data.proofMethod === 'QR_CODE';

  const submit = async (payload: Omit<DeliverPayload, 'deliveryId'>) => {
    if (data.requiresIdCheck && !idChecked) return setError('Confira o documento com foto do recebedor antes de concluir.');
    setBusy(true);
    setError(null);
    try {
      const result = await driver.deliver({ deliveryId: data.id, idChecked: data.requiresIdCheck ? idChecked : undefined, ...payload });
      toast.success(result === 'sent' ? 'Entrega concluída!' : 'Entrega registrada. Será confirmada quando a internet voltar.');
      router.back();
    } catch (err) {
      setError(errorMessage(err));
      scanned.current = false;
    } finally {
      setBusy(false);
    }
  };

  const takePhoto = async () => {
    const granted = (await ImagePicker.requestCameraPermissionsAsync()).granted;
    if (!granted) return toast.error(new Error('Permita o uso da câmera nas configurações.'));
    const result = await ImagePicker.launchCameraAsync({ quality: 0.6, exif: false });
    if (!result.canceled && result.assets[0]) setPhoto(result.assets[0].uri);
  };

  const idCheck = data.requiresIdCheck ? <Checkbox checked={idChecked} onChange={setIdChecked} label="Conferi o documento com foto: o recebedor tem 18 anos ou mais." /> : null;

  if (data.proofMethod === 'SIGNATURE') {
    return (
      <Screen scroll={false}>
        <Text tone="muted">Peça para quem recebeu assinar e informar o nome.</Text>
        <Field label="Nome de quem recebeu" value={recipientName} onChangeText={setRecipientName} autoCapitalize="words" />
        <SignaturePad ref={signature} onChange={setHasInk} height={240} />
        <Button title="Limpar assinatura" variant="ghost" size="sm" onPress={() => signature.current?.clear()} />
        {idCheck}
        {error ? <Text tone="danger">{error}</Text> : null}
        <Button
          title="Concluir entrega"
          variant="success"
          size="lg"
          loading={busy}
          disabled={!hasInk || recipientName.trim().length < 2}
          onPress={async () => {
            const uri = await signature.current?.capture();
            if (!uri) return setError('Colete a assinatura.');
            const saved = persist(uri, `assinatura-${data.id}-${Date.now()}.png`);
            await submit({ method: 'SIGNATURE', recipientName: recipientName.trim(), file: { uri: saved, name: 'assinatura.png', mimeType: 'image/png' } });
          }}
        />
      </Screen>
    );
  }

  if (data.proofMethod === 'PHOTO') {
    return (
      <Screen>
        <Text tone="muted">Fotografe o item entregue no local (porta, portaria ou com quem recebeu).</Text>
        {photo ? <Image source={{ uri: photo }} style={{ width: '100%', height: 320, borderRadius: radius.lg }} accessibilityIgnoresInvertColors /> : null}
        <Button title={photo ? 'Tirar outra foto' : 'Tirar foto'} icon="camera" variant={photo ? 'secondary' : 'primary'} onPress={takePhoto} />
        <Field label="Nome de quem recebeu (opcional)" value={recipientName} onChangeText={setRecipientName} />
        {idCheck}
        {error ? <Text tone="danger">{error}</Text> : null}
        <Button
          title="Concluir entrega"
          variant="success"
          size="lg"
          loading={busy}
          disabled={!photo}
          onPress={() => {
            const saved = persist(photo!, `foto-${data.id}-${Date.now()}.jpg`);
            void submit({ method: 'PHOTO', recipientName: recipientName.trim() || undefined, file: { uri: saved, name: 'entrega.jpg', mimeType: 'image/jpeg' } });
          }}
        />
      </Screen>
    );
  }

  return (
    <Screen>
      <Text tone="muted">Peça o código de entrega de 4 dígitos ou leia o QR Code no celular de quem recebe ({PROOF_METHOD_LABELS[data.proofMethod]}).</Text>
      {byCode ? <Segmented value={mode} onChange={setMode} options={[{ value: 'code', label: 'Digitar código' }, { value: 'qr', label: 'Ler QR Code' }]} /> : null}
      {mode === 'code' ? (
        <Stack>
          <Field
            label="Código de entrega"
            value={code}
            onChangeText={(value) => setCode(value.replace(/\D/g, '').slice(0, 4))}
            keyboardType="number-pad"
            autoFocus
            style={{ fontSize: 32, letterSpacing: 12, textAlign: 'center' }}
          />
          {idCheck}
          {error ? <Text tone="danger">{error}</Text> : null}
          <Button title="Concluir entrega" variant="success" size="lg" loading={busy} disabled={code.length !== 4} onPress={() => submit({ method: 'CODE', code })} />
        </Stack>
      ) : !permission?.granted ? (
        <Stack>
          <Text>Precisamos da câmera para ler o QR Code.</Text>
          <Button title="Permitir câmera" onPress={requestPermission} />
        </Stack>
      ) : (
        <Stack>
          <View style={{ height: 320, borderRadius: radius.lg, overflow: 'hidden', backgroundColor: colors.surface2 }}>
            <CameraView
              style={{ flex: 1 }}
              facing="back"
              barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
              onBarcodeScanned={({ data: value }) => {
                if (scanned.current || busy) return;
                if (!value.startsWith('LEVOJA:')) return setError('Este QR Code não é de uma entrega LevoJá.');
                if (!value.includes(data.code)) return setError('Este QR Code é de outra entrega.');
                scanned.current = true;
                void submit({ method: 'QR_CODE', code: value });
              }}
            />
          </View>
          {idCheck}
          {error ? <Text tone="danger">{error}</Text> : null}
          {busy ? <Loading label="Confirmando…" /> : null}
        </Stack>
      )}
      <Row style={{ marginTop: space(2) }}>
        <Text variant="caption" tone="muted">
          A conclusão só é aceita perto do endereço de entrega.
        </Text>
      </Row>
    </Screen>
  );
}
