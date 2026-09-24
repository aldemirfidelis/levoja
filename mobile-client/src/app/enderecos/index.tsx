import { router } from 'expo-router';
import { api, Badge, Button, confirm, EmptyState, IconButton, ListGroup, ListItem, Loading, Row, Screen, useInvalidate, useToast } from '@levoja/mobile-kit';
import { addressLine, useAddress } from '@/lib/address';

export default function AddressesScreen() {
  const { addresses, selected, select, isLoading, refresh } = useAddress();
  const toast = useToast();
  const invalidate = useInvalidate();
  if (isLoading) return <Loading />;
  return (
    <Screen footer={<Button title="Adicionar endereço" icon="plus" onPress={() => router.push('/enderecos/editar')} fullWidth />} refreshing={false} onRefresh={() => refresh()}>
      {addresses.length === 0 ? <EmptyState icon="location" title="Nenhum endereço" description="Cadastre onde você quer receber seus pedidos." /> : null}
      <ListGroup>
        {addresses.map((address) => (
          <ListItem
            key={address.id}
            icon={address.id === selected?.id ? 'checkCircle' : 'location'}
            title={address.label || addressLine(address)}
            subtitle={`${address.label ? `${addressLine(address)} · ` : ''}${address.city}/${address.state}`}
            chevron={false}
            onPress={() => {
              select(address.id);
              router.back();
            }}
            right={
              <Row gap={0}>
                {address.isDefault ? <Badge label="Padrão" tone="brand" /> : null}
                <IconButton icon="edit" label="Editar" onPress={() => router.push({ pathname: '/enderecos/editar', params: { id: address.id } })} />
                <IconButton
                  icon="trash"
                  label="Excluir"
                  onPress={async () => {
                    if (!(await confirm('Excluir endereço?', addressLine(address), { destructive: true, confirmLabel: 'Excluir' }))) return;
                    try {
                      await api.delete(`me/addresses/${address.id}`);
                      await invalidate('me/addresses');
                    } catch (err) {
                      toast.error(err);
                    }
                  }}
                />
              </Row>
            }
          />
        ))}
      </ListGroup>
    </Screen>
  );
}
