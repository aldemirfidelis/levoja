import { useEffect, useMemo, useState } from 'react';
import { Image, Pressable, View } from 'react-native';
import { api, Badge, Button, errorMessage, Field, formatBRL, Icon, radius, Row, Sheet, space, Stepper, Text, useApiMutation, useColors, useToast } from '@levoja/mobile-kit';
import type { Product } from '@/lib/types';

/** Detalhe do produto com adicionais/variações (regras de mínimo e máximo por grupo). */
export function ProductSheet({ product, onClose }: { product: Product | null; onClose: () => void }) {
  const colors = useColors();
  const toast = useToast();
  const [selected, setSelected] = useState<Record<string, string[]>>({});
  const [quantity, setQuantity] = useState(1);
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setSelected({});
    setQuantity(1);
    setNotes('');
    setError(null);
  }, [product?.id]);

  const add = useApiMutation((body: { productId: string; quantity: number; optionIds: string[]; notes?: string }) => api.post('cart/items', body), ['cart']);

  const unitCents = useMemo(() => {
    if (!product) return 0;
    const chosen = new Set(Object.values(selected).flat());
    const options = product.optionGroups.flatMap((group) => group.options).filter((option) => chosen.has(option.id));
    return product.effectivePriceCents + options.reduce((sum, option) => sum + option.priceDeltaCents, 0);
  }, [product, selected]);

  if (!product) return null;

  const toggle = (groupId: string, optionId: string, maxSelect: number) => {
    setSelected((current) => {
      const ids = current[groupId] ?? [];
      if (ids.includes(optionId)) return { ...current, [groupId]: ids.filter((id) => id !== optionId) };
      if (maxSelect === 1) return { ...current, [groupId]: [optionId] };
      if (ids.length >= maxSelect) return current;
      return { ...current, [groupId]: [...ids, optionId] };
    });
  };

  const submit = async () => {
    for (const group of product.optionGroups) {
      const count = selected[group.id]?.length ?? 0;
      if (count < group.minSelect) return setError(`Escolha ${group.minSelect === 1 ? 'uma opção' : `ao menos ${group.minSelect} opções`} em "${group.name}".`);
    }
    setError(null);
    try {
      await add.mutateAsync({ productId: product.id, quantity, optionIds: Object.values(selected).flat(), notes: notes.trim() || undefined });
      toast.success(`${product.name} adicionado à sacola.`);
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const image = product.images[0]?.url;
  return (
    <Sheet
      visible
      onClose={onClose}
      title={product.name}
      footer={
        <Row gap={3}>
          <Stepper value={quantity} onChange={setQuantity} min={1} max={99} />
          <Button title={`Adicionar ${formatBRL(unitCents * quantity)}`} onPress={submit} loading={add.isPending} disabled={!product.available} style={{ flex: 1 }} />
        </Row>
      }
    >
      {image ? <Image source={{ uri: image }} style={{ width: '100%', height: 200, borderRadius: radius.lg }} accessibilityIgnoresInvertColors /> : null}
      {product.description ? <Text tone="muted">{product.description}</Text> : null}
      <Row gap={2}>
        <Text variant="heading">{formatBRL(product.effectivePriceCents)}</Text>
        {product.onSale ? (
          <Text tone="muted" style={{ textDecorationLine: 'line-through' }}>
            {formatBRL(product.priceCents)}
          </Text>
        ) : null}
      </Row>
      {product.requiresPrescription ? <Badge label="Exige receita — envie na sacola" tone="warning" /> : null}
      {product.minimumAge ? <Badge label={`Venda para maiores de ${product.minimumAge} anos · documento conferido na entrega`} tone="info" /> : null}
      {product.comboItems.length ? (
        <Text variant="caption" tone="muted">
          Inclui: {product.comboItems.map((item) => `${item.quantity}× ${item.name}`).join(', ')}
        </Text>
      ) : null}
      {product.optionGroups.map((group) => (
        <View key={group.id} style={{ gap: space(2) }}>
          <Row justify="space-between">
            <Text weight="700">{group.name}</Text>
            <Text variant="caption" tone="muted">
              {group.minSelect > 0 ? 'Obrigatório · ' : ''}
              {group.maxSelect === 1 ? 'escolha 1' : `até ${group.maxSelect}`}
            </Text>
          </Row>
          {group.options.map((option) => {
            const checked = (selected[group.id] ?? []).includes(option.id);
            return (
              <Pressable
                key={option.id}
                disabled={!option.available}
                accessibilityRole={group.maxSelect === 1 ? 'radio' : 'checkbox'}
                accessibilityState={{ checked, disabled: !option.available }}
                onPress={() => toggle(group.id, option.id, group.maxSelect)}
                style={{ flexDirection: 'row', alignItems: 'center', gap: space(3), paddingVertical: space(2.5), borderBottomWidth: 1, borderBottomColor: colors.border, opacity: option.available ? 1 : 0.4 }}
              >
                <Icon name={checked ? 'checkCircle' : 'plus'} size={20} color={checked ? colors.brand : colors.muted} />
                <Text style={{ flex: 1 }}>{option.name}</Text>
                {option.priceDeltaCents ? <Text tone="muted">+ {formatBRL(option.priceDeltaCents)}</Text> : null}
                {!option.available ? <Text variant="caption" tone="muted">Esgotado</Text> : null}
              </Pressable>
            );
          })}
        </View>
      ))}
      <Field label="Observações" value={notes} onChangeText={setNotes} placeholder="Ex.: sem cebola" maxLength={200} />
      {!product.available ? <Text tone="danger">Produto indisponível no momento.</Text> : null}
      {error ? <Text tone="danger">{error}</Text> : null}
    </Sheet>
  );
}
