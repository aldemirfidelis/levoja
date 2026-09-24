import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { router } from 'expo-router';
import { Button, Icon, ListGroup, ListItem, Sheet, Text, useColors } from '@levoja/mobile-kit';
import { addressLine, useAddress } from '@/lib/address';

/** Cabeçalho "Entregar em ..." com troca rápida de endereço. */
export function AddressSelector() {
  const colors = useColors();
  const { addresses, selected, select } = useAddress();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Pressable accessibilityRole="button" accessibilityLabel="Trocar endereço de entrega" onPress={() => (addresses.length ? setOpen(true) : router.push('/enderecos/editar'))} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Icon name="location" size={20} color={colors.brand} />
        <View style={{ flexShrink: 1 }}>
          <Text variant="caption" tone="muted">
            {selected ? 'Entregar em' : 'Onde você está?'}
          </Text>
          <Text weight="700" numberOfLines={1}>
            {selected ? addressLine(selected) : 'Adicionar endereço'}
          </Text>
        </View>
        <Icon name="chevronRight" size={16} color={colors.muted} />
      </Pressable>
      <Sheet visible={open} onClose={() => setOpen(false)} title="Endereço de entrega" footer={<Button title="Gerenciar endereços" variant="secondary" onPress={() => { setOpen(false); router.push('/enderecos'); }} />}>
        <ListGroup>
          {addresses.map((address) => (
            <ListItem
              key={address.id}
              icon={address.id === selected?.id ? 'checkCircle' : 'location'}
              title={address.label || addressLine(address)}
              subtitle={address.label ? addressLine(address) : `${address.city}/${address.state}`}
              chevron={false}
              onPress={() => {
                select(address.id);
                setOpen(false);
              }}
            />
          ))}
        </ListGroup>
        <Button title="Adicionar endereço" icon="plus" variant="ghost" onPress={() => { setOpen(false); router.push('/enderecos/editar'); }} />
      </Sheet>
    </>
  );
}
