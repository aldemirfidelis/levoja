import { View } from 'react-native';
import { router } from 'expo-router';
import Constants from 'expo-constants';
import * as WebBrowser from 'expo-web-browser';
import { Avatar, Badge, confirm, kitConfig, ListGroup, ListItem, Row, Screen, space, Text, useApi, useAuth } from '@levoja/mobile-kit';
import { useDriver } from '@/lib/driver';

export default function AccountTab() {
  const { me, logout } = useAuth();
  const driver = useDriver();
  const notifications = useApi<{ unread: number }>('me/notifications', { pageSize: 1 });
  if (!me) return null;
  return (
    <Screen>
      <Row gap={4}>
        <Avatar uri={me.user.avatarUrl} name={me.user.name} size={64} />
        <View style={{ flex: 1 }}>
          <Text variant="heading">{me.user.name}</Text>
          <Text tone="muted">{me.user.email}</Text>
          {driver.dashboard?.rating.count ? <Badge label={`★ ${driver.dashboard.rating.average.toFixed(1)} (${driver.dashboard.rating.count})`} tone="warning" /> : null}
        </View>
      </Row>
      <ListGroup title="Entregador">
        <ListItem icon="person" title="Dados pessoais e CNH" onPress={() => router.push('/cadastro/dados')} />
        <ListItem icon="scooter" title="Veículo" onPress={() => router.push('/cadastro/veiculo')} />
        <ListItem icon="document" title="Documentos" onPress={() => router.push('/cadastro/documentos')} />
        <ListItem icon="pix" title="Chave PIX para receber" onPress={() => router.push('/conta/dados-bancarios')} />
      </ListGroup>
      <ListGroup title="Conta">
        <ListItem icon="account" title="Meus dados" onPress={() => router.push('/conta/perfil')} />
        <ListItem icon="bell" title="Notificações" right={notifications.data?.unread ? <Badge label={String(notifications.data.unread)} tone="brand" /> : undefined} onPress={() => router.push('/conta/notificacoes')} />
        <ListItem icon="lock" title="Segurança" onPress={() => router.push('/conta/seguranca')} />
        <ListItem icon="shield" title="Privacidade (LGPD)" onPress={() => router.push('/conta/privacidade')} />
      </ListGroup>
      <ListGroup title="Ajuda">
        <ListItem icon="chat" title="Meus chamados" subtitle="Fale com o suporte sobre entregas, ganhos e seu cadastro" onPress={() => router.push('/ajuda')} />
        <ListItem icon="help" title="Central de ajuda" onPress={() => WebBrowser.openBrowserAsync(`${kitConfig().webUrl}/ajuda`)} />
        <ListItem icon="document" title="Termos do Entregador" onPress={() => WebBrowser.openBrowserAsync(`${kitConfig().webUrl}/termos-entregador`)} />
      </ListGroup>
      <ListGroup>
        <ListItem
          icon="logout"
          title="Sair"
          destructive
          chevron={false}
          onPress={async () => {
            if (driver.online && !(await confirm('Sair da conta?', 'Você ficará offline e deixará de receber entregas.', { confirmLabel: 'Sair', destructive: true }))) return;
            if (driver.online) await driver.goOffline();
            await logout();
          }}
        />
      </ListGroup>
      <Text variant="caption" tone="muted" align="center" style={{ marginTop: space(2) }}>
        Versão {Constants.expoConfig?.version ?? '—'}
      </Text>
    </Screen>
  );
}
