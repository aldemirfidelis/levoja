import { useState } from 'react';
import { View } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { DOCUMENT_STATUS_LABELS, DRIVER_DOCUMENT_LABELS, DRIVER_DOCUMENT_TYPES, requiredDriverDocuments, type DriverDocumentType } from '@levoja/shared';
import { api, Badge, Button, Card, confirm, ErrorView, formatDateTime, Loading, Row, Screen, Stack, Text, upload, useApi, useToast, type LocalFile } from '@levoja/mobile-kit';
import type { DriverDoc, DriverProfile } from '@/lib/types';

const TONE = { PENDING: 'warning', APPROVED: 'success', REJECTED: 'danger' } as const;

async function pick(source: 'camera' | 'gallery' | 'files', selfie: boolean): Promise<LocalFile | null> {
  if (source === 'files') {
    const result = await DocumentPicker.getDocumentAsync({ type: ['application/pdf', 'image/*'], copyToCacheDirectory: true });
    return !result.canceled && result.assets[0] ? { uri: result.assets[0].uri, name: result.assets[0].name, mimeType: result.assets[0].mimeType } : null;
  }
  if (source === 'camera') {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) throw new Error('Permita o uso da câmera nas configurações.');
    const result = await ImagePicker.launchCameraAsync({ quality: 0.7, cameraType: selfie ? ImagePicker.CameraType.front : ImagePicker.CameraType.back });
    return !result.canceled && result.assets[0] ? { uri: result.assets[0].uri, name: result.assets[0].fileName, mimeType: result.assets[0].mimeType } : null;
  }
  const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.7 });
  return !result.canceled && result.assets[0] ? { uri: result.assets[0].uri, name: result.assets[0].fileName, mimeType: result.assets[0].mimeType } : null;
}

function DocumentRow({ type, required, documents, editable, onChanged }: { type: DriverDocumentType; required: boolean; documents: DriverDoc[]; editable: boolean; onChanged: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const latest = documents[0];

  const send = async (source: 'camera' | 'gallery' | 'files') => {
    try {
      const file = await pick(source, type === 'SELFIE');
      if (!file) return;
      setBusy(true);
      await upload('drivers/me/documents', 'file', file, { type });
      toast.success(`${DRIVER_DOCUMENT_LABELS[type]} enviado.`);
      onChanged();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <Stack gap={2}>
        <Row justify="space-between">
          <Text weight="700" style={{ flex: 1 }}>
            {DRIVER_DOCUMENT_LABELS[type]}
            {required ? ' *' : ''}
          </Text>
          {latest ? <Badge label={DOCUMENT_STATUS_LABELS[latest.status]} tone={TONE[latest.status]} /> : <Badge label={required ? 'Pendente' : 'Opcional'} tone={required ? 'warning' : 'neutral'} />}
        </Row>
        {latest ? (
          <Text variant="caption" tone="muted">
            {latest.fileName} · {formatDateTime(latest.createdAt)}
          </Text>
        ) : null}
        {latest?.reviewNote ? <Text variant="caption" tone="danger">{latest.reviewNote}</Text> : null}
        {type === 'SELFIE' ? <Text variant="caption" tone="muted">Tire uma foto do rosto segurando o documento ao lado.</Text> : null}
        {editable ? (
          <Row gap={2}>
            <Button title="Câmera" icon="camera" size="sm" variant="secondary" loading={busy} onPress={() => send('camera')} style={{ flex: 1 }} />
            {type !== 'SELFIE' ? <Button title="Galeria" icon="image" size="sm" variant="secondary" disabled={busy} onPress={() => send('gallery')} style={{ flex: 1 }} /> : null}
            {type !== 'SELFIE' ? <Button title="PDF" icon="document" size="sm" variant="secondary" disabled={busy} onPress={() => send('files')} style={{ flex: 1 }} /> : null}
          </Row>
        ) : null}
        {editable && latest && latest.status !== 'APPROVED' ? (
          <Button
            title="Remover"
            size="sm"
            variant="ghost"
            onPress={async () => {
              if (!(await confirm('Remover documento?', latest.fileName, { destructive: true, confirmLabel: 'Remover' }))) return;
              await api.delete(`drivers/me/documents/${latest.id}`).then(onChanged).catch(toast.error);
            }}
          />
        ) : null}
      </Stack>
    </Card>
  );
}

export default function DocumentsScreen() {
  const profile = useApi<DriverProfile>('drivers/me');
  if (profile.isLoading) return <Loading />;
  if (profile.error || !profile.data) return <ErrorView error={profile.error} onRetry={() => profile.refetch()} />;
  const driver = profile.data;
  const vehicle = driver.vehicles.find((item) => item.id === driver.activeVehicleId) ?? driver.vehicles[0];
  const required = requiredDriverDocuments(vehicle?.type ?? 'MOTORCYCLE');
  const editable = ['DRAFT', 'PENDING_DOCUMENTS', 'REJECTED', 'APPROVED'].includes(driver.status);
  const types = [...required, ...DRIVER_DOCUMENT_TYPES.filter((type) => !required.includes(type))];

  return (
    <Screen refreshing={profile.isRefetching} onRefresh={() => profile.refetch()}>
      <Text tone="muted">Envie fotos nítidas, sem reflexos e com todas as informações legíveis. Arquivos aceitos: foto (JPG/PNG) ou PDF.</Text>
      {!editable ? <Text tone="warning">Cadastro em análise: aguarde o resultado para enviar novos documentos.</Text> : null}
      <View style={{ gap: 12 }}>
        {types.map((type) => (
          <DocumentRow key={type} type={type} required={required.includes(type)} documents={driver.documents.filter((doc) => doc.type === type)} editable={editable} onChanged={() => void profile.refetch()} />
        ))}
      </View>
    </Screen>
  );
}
