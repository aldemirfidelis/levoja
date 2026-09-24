import { ReactNode } from 'react';
import { Image, KeyboardAvoidingView, Platform, Pressable, RefreshControl, ScrollView, Switch, View, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { radius, space, useColors } from '../theme';
import { Icon, type IconName } from './icon';
import { Row, Text } from './primitives';

/**
 * Tela padrão: fundo do tema, rolagem com "puxar para atualizar", teclado não cobre campos
 * e rodapé fixo (ações principais) respeitando a área segura.
 */
export function Screen({
  children,
  scroll = true,
  refreshing,
  onRefresh,
  footer,
  padded = true,
  contentStyle,
}: {
  children: ReactNode;
  scroll?: boolean;
  refreshing?: boolean;
  onRefresh?: () => void;
  footer?: ReactNode;
  padded?: boolean;
  contentStyle?: StyleProp<ViewStyle>;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const padding: ViewStyle = padded ? { padding: space(4), gap: space(4) } : {};
  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={Platform.OS === 'ios' ? 64 : 0}>
      {scroll ? (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={[padding, { paddingBottom: (footer ? space(4) : insets.bottom + space(6)) }, contentStyle]}
          keyboardShouldPersistTaps="handled"
          refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={colors.brand} colors={[colors.brand]} /> : undefined}
        >
          {children}
        </ScrollView>
      ) : (
        <View style={[{ flex: 1 }, padding, contentStyle]}>{children}</View>
      )}
      {footer ? (
        <View style={{ padding: space(4), paddingBottom: insets.bottom + space(3), borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.surface, gap: space(2) }}>{footer}</View>
      ) : null}
    </KeyboardAvoidingView>
  );
}

export function ListItem({
  title,
  subtitle,
  icon,
  right,
  onPress,
  chevron = !!onPress,
  destructive,
}: {
  title: string;
  subtitle?: string | null;
  icon?: IconName;
  right?: ReactNode;
  onPress?: () => void;
  chevron?: boolean;
  destructive?: boolean;
}) {
  const colors = useColors();
  const content = (
    <Row gap={3} style={{ paddingVertical: space(3.5), paddingHorizontal: space(4) }}>
      {icon ? <Icon name={icon} size={22} color={destructive ? colors.danger : colors.muted} /> : null}
      <View style={{ flex: 1, gap: 2 }}>
        <Text weight="600" tone={destructive ? 'danger' : 'default'}>
          {title}
        </Text>
        {subtitle ? (
          <Text variant="caption" tone="muted">
            {subtitle}
          </Text>
        ) : null}
      </View>
      {right}
      {chevron ? <Icon name="chevronRight" size={18} color={colors.muted} /> : null}
    </Row>
  );
  if (!onPress) return content;
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => ({ backgroundColor: pressed ? colors.surface2 : 'transparent' })}>
      {content}
    </Pressable>
  );
}

/** Grupo de itens com bordas arredondadas (menus de conta, configurações). */
export function ListGroup({ children, title }: { children: ReactNode; title?: string }) {
  const colors = useColors();
  const items = (Array.isArray(children) ? children : [children]).filter(Boolean);
  return (
    <View style={{ gap: space(2) }}>
      {title ? (
        <Text variant="label" tone="muted" style={{ paddingHorizontal: space(1) }}>
          {title.toUpperCase()}
        </Text>
      ) : null}
      <View style={{ backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' }}>
        {items.map((child, index) => (
          <View key={index} style={index > 0 ? { borderTopWidth: 1, borderTopColor: colors.border } : undefined}>
            {child}
          </View>
        ))}
      </View>
    </View>
  );
}

export function ToggleRow({ title, subtitle, value, onChange, disabled }: { title: string; subtitle?: string; value: boolean; onChange: (value: boolean) => void; disabled?: boolean }) {
  const colors = useColors();
  return (
    <ListItem
      title={title}
      subtitle={subtitle}
      chevron={false}
      right={<Switch value={value} onValueChange={onChange} disabled={disabled} trackColor={{ true: colors.brand, false: colors.border }} thumbColor="#ffffff" accessibilityLabel={title} />}
    />
  );
}

export function Chip({ label, selected, onPress, icon }: { label: string; selected?: boolean; onPress?: () => void; icon?: IconName }) {
  const colors = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: !!selected }}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: space(1.5),
        paddingHorizontal: space(3.5),
        paddingVertical: space(2),
        borderRadius: radius.full,
        borderWidth: 1,
        borderColor: selected ? colors.brand : colors.border,
        backgroundColor: selected ? colors.brandSoft : pressed ? colors.surface2 : colors.surface,
      })}
    >
      {icon ? <Icon name={icon} size={16} color={selected ? colors.brand : colors.muted} /> : null}
      <Text variant="label" style={{ color: selected ? colors.brand : colors.fg }}>
        {label}
      </Text>
    </Pressable>
  );
}

export function Segmented<T extends string>({ value, onChange, options }: { value: T; onChange: (value: T) => void; options: { value: T; label: string }[] }) {
  const colors = useColors();
  return (
    <Row gap={1} style={{ backgroundColor: colors.surface2, borderRadius: radius.md, padding: 3 }}>
      {options.map((option) => {
        const active = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            onPress={() => onChange(option.value)}
            style={{ flex: 1, paddingVertical: space(2), borderRadius: radius.sm, backgroundColor: active ? colors.surface : 'transparent', alignItems: 'center' }}
          >
            <Text variant="label" tone={active ? 'default' : 'muted'}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </Row>
  );
}

/** Opção selecionável em cartão (forma de pagamento, tipo de entrega). */
export function RadioCard({ title, subtitle, selected, onPress, icon, disabled, right }: { title: string; subtitle?: string; selected: boolean; onPress: () => void; icon?: IconName; disabled?: boolean; right?: ReactNode }) {
  const colors = useColors();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: selected, disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: space(3),
        padding: space(3.5),
        borderRadius: radius.md,
        borderWidth: selected ? 2 : 1,
        borderColor: selected ? colors.brand : colors.border,
        backgroundColor: selected ? colors.brandSoft : colors.surface,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {icon ? <Icon name={icon} size={22} color={selected ? colors.brand : colors.muted} /> : null}
      <View style={{ flex: 1 }}>
        <Text weight="600">{title}</Text>
        {subtitle ? (
          <Text variant="caption" tone="muted">
            {subtitle}
          </Text>
        ) : null}
      </View>
      {right}
      <View style={{ width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: selected ? colors.brand : colors.border, alignItems: 'center', justifyContent: 'center' }}>
        {selected ? <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: colors.brand }} /> : null}
      </View>
    </Pressable>
  );
}

export function Checkbox({ label, checked, onChange }: { label: ReactNode; checked: boolean; onChange: (value: boolean) => void }) {
  const colors = useColors();
  return (
    <Pressable accessibilityRole="checkbox" accessibilityState={{ checked }} onPress={() => onChange(!checked)} style={{ flexDirection: 'row', gap: space(3), alignItems: 'flex-start' }}>
      <View style={{ width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: checked ? colors.brand : colors.border, backgroundColor: checked ? colors.brand : 'transparent', alignItems: 'center', justifyContent: 'center', marginTop: 1 }}>
        {checked ? <Icon name="check" size={14} color="#ffffff" /> : null}
      </View>
      <View style={{ flex: 1 }}>{typeof label === 'string' ? <Text>{label}</Text> : label}</View>
    </Pressable>
  );
}

export function Stepper({ value, onChange, min = 0, max = 99 }: { value: number; onChange: (value: number) => void; min?: number; max?: number }) {
  const colors = useColors();
  const button = (icon: IconName, next: number, label: string) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={next < min || next > max}
      onPress={() => onChange(next)}
      style={({ pressed }) => ({ width: 36, height: 36, borderRadius: radius.full, alignItems: 'center', justifyContent: 'center', backgroundColor: pressed ? colors.surface2 : colors.surface, borderWidth: 1, borderColor: colors.border, opacity: next < min || next > max ? 0.4 : 1 })}
    >
      <Icon name={icon} size={18} color={colors.brand} />
    </Pressable>
  );
  return (
    <Row gap={3}>
      {button('minus', value - 1, 'Diminuir')}
      <Text variant="subheading" style={{ minWidth: 24, textAlign: 'center' }} accessibilityLiveRegion="polite">
        {value}
      </Text>
      {button('plus', value + 1, 'Aumentar')}
    </Row>
  );
}

export function Avatar({ uri, name, size = 48 }: { uri?: string | null; name: string; size?: number }) {
  const colors = useColors();
  if (uri) return <Image source={{ uri }} style={{ width: size, height: size, borderRadius: size / 2 }} accessibilityIgnoresInvertColors />;
  const initials = name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: colors.brandSoft, alignItems: 'center', justifyContent: 'center' }}>
      <Text weight="800" style={{ color: colors.brand, fontSize: size * 0.38 }}>
        {initials || '?'}
      </Text>
    </View>
  );
}
