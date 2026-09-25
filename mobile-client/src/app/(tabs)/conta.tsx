import { View } from 'react-native';
import { router } from 'expo-router';
import Constants from 'expo-constants';
import * as WebBrowser from 'expo-web-browser';
import { Avatar, Badge, confirm, formatBRL, kitConfig, ListGroup, ListItem, Row, Screen, space, Text, useApi, useAuth } from '@levoja/mobile-kit';

export default function AccountTab() {
  const { me, logout } = useAuth();
  const credits = useApi<{ availableCents: number }>('customers/me/wallet');
  const notifications = useApi<{ unread: number }>('me/notifications', { pageSize: 1 });
  const home = useApi<{ loyalty: { points: number; tier: { name: string } } | null; referral: { referrerRewardCents: number } | null }>('me/home');
  if (!me) return null;
  return (
    <Screen>
      <Row gap={4}>
        <Avatar uri={me.user.avatarUrl} name={me.user.name} size={64} />
        <View style={{ flex: 1 }}>
          <Text variant="heading">{me.user.name}</Text>
          <Text tone="muted">{me.user.email}</Text>
        </View>
      </Row>
      <ListGroup title="Minha conta">
        <ListItem icon="person" title="Meus dados" onPress={() => router.push('/conta/perfil')} />
        <ListItem icon="location" title="Endereços" onPress={() => router.push('/enderecos')} />
        <ListItem icon="wallet" title="Créditos" subtitle={credits.data ? formatBRL(credits.data.availableCents) : undefined} onPress={() => router.push('/conta/creditos')} />
        <ListItem icon="bell" title="Notificações" right={notifications.data?.unread ? <Badge label={String(notifications.data.unread)} tone="brand" /> : undefined} onPress={() => router.push('/conta/notificacoes')} />
      </ListGroup>
      <ListGroup title="Vantagens">
        {home.data?.loyalty ? (
          <ListItem icon="trophy" title="Fidelidade" subtitle={`${home.data.loyalty.tier.name} · ${home.data.loyalty.points.toLocaleString('pt-BR')} pontos`} onPress={() => router.push('/conta/fidelidade')} />
        ) : null}
        {home.data?.referral ? (
          <ListItem icon="gift" title="Indique e ganhe" subtitle={`Ganhe ${formatBRL(home.data.referral.referrerRewardCents)} por amigo indicado`} onPress={() => router.push('/conta/indique')} />
        ) : null}
        <ListItem icon="coupon" title="Meus cupons" onPress={() => router.push('/conta/cupons')} />
        <ListItem icon="favorite" title="Lojas favoritas" onPress={() => router.push('/conta/favoritas')} />
      </ListGroup>
      <ListGroup title="Segurança e privacidade">
        <ListItem icon="lock" title="Senha, verificação em duas etapas e sessões" onPress={() => router.push('/conta/seguranca')} />
        <ListItem icon="shield" title="Privacidade e dados (LGPD)" onPress={() => router.push('/conta/privacidade')} />
      </ListGroup>
      <ListGroup title="Ajuda">
        <ListItem icon="chat" title="Meus chamados" subtitle="Fale com a nossa equipe sobre pedidos, pagamentos e sua conta" onPress={() => router.push('/ajuda')} />
        <ListItem icon="help" title="Central de ajuda" onPress={() => WebBrowser.openBrowserAsync(`${kitConfig().webUrl}/ajuda`)} />
      </ListGroup>
      <ListGroup>
        <ListItem
          icon="logout"
          title="Sair"
          destructive
          chevron={false}
          onPress={async () => {
            if (await confirm('Sair da conta?', 'Você precisará entrar novamente neste aparelho.', { confirmLabel: 'Sair' })) await logout();
          }}
        />
      </ListGroup>
      <Text variant="caption" tone="muted" align="center" style={{ marginTop: space(2) }}>
        Versão {Constants.expoConfig?.version ?? '—'}
      </Text>
    </Screen>
  );
}
