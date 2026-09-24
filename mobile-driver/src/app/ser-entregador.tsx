import { useState } from 'react';
import * as WebBrowser from 'expo-web-browser';
import { VEHICLE_TYPE_LABELS, VEHICLE_TYPES, type VehicleType } from '@levoja/shared';
import { api, Button, Checkbox, Chip, errorMessage, kitConfig, Row, Screen, Stack, Text, useAuth } from '@levoja/mobile-kit';

/** Conta existente (ex.: cliente) que ainda não tem perfil de entregador. */
export default function BecomeDriver() {
  const { me, reload, logout } = useAuth();
  const [vehicleType, setVehicleType] = useState<VehicleType>('MOTORCYCLE');
  const [terms, setTerms] = useState(false);
  const [location, setLocation] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.post('drivers/me', { vehicleType });
      // Com o perfil criado, os Termos do Entregador passam a ser exigidos: registra o aceite e a localização.
      await api.post('me/consents/accept-current');
      await api.post('me/consents', { type: 'LOCATION_TRACKING', granted: true });
      await reload();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen footer={<Button title="Começar meu cadastro" onPress={create} loading={busy} disabled={!terms || !location} fullWidth size="lg" />}>
      <Text variant="title">Olá, {me?.user.name.split(' ')[0]}!</Text>
      <Text tone="muted">Sua conta ainda não tem cadastro de entregador. Escolha o veículo que você vai usar:</Text>
      <Row gap={2} style={{ flexWrap: 'wrap' }}>
        {VEHICLE_TYPES.map((type) => (
          <Chip key={type} label={VEHICLE_TYPE_LABELS[type]} selected={vehicleType === type} onPress={() => setVehicleType(type)} />
        ))}
      </Row>
      <Stack gap={3}>
        <Checkbox
          checked={terms}
          onChange={setTerms}
          label={
            <Text>
              Li e aceito os{' '}
              <Text tone="brand" onPress={() => WebBrowser.openBrowserAsync(`${kitConfig().webUrl}/termos-entregador`)}>
                Termos do Entregador
              </Text>
              .
            </Text>
          }
        />
        <Checkbox checked={location} onChange={setLocation} label="Autorizo o uso da minha localização enquanto estiver online ou com entregas em andamento." />
      </Stack>
      {error ? <Text tone="danger">{error}</Text> : null}
      <Button title="Sair desta conta" variant="ghost" onPress={logout} />
    </Screen>
  );
}
