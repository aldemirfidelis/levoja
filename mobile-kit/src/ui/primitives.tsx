import { forwardRef, ReactNode, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  Text as RNText,
  TextInput,
  View,
  type PressableProps,
  type StyleProp,
  type TextInputProps,
  type TextProps as RNTextProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { radius, space, toneColor, typography, useColors, type Tone, type TypographyVariant } from '../theme';
import { Icon, type IconName } from './icon';

// -----------------------------------------------------------------------------
// Texto
// -----------------------------------------------------------------------------

export interface TextProps extends RNTextProps {
  variant?: TypographyVariant;
  tone?: Tone | 'default' | 'muted' | 'onBrand';
  align?: TextStyle['textAlign'];
  weight?: TextStyle['fontWeight'];
}

export function Text({ variant = 'body', tone = 'default', align, weight, style, ...props }: TextProps) {
  const colors = useColors();
  const color = tone === 'default' ? colors.fg : tone === 'muted' ? colors.muted : tone === 'onBrand' ? colors.onBrand : toneColor(colors, tone);
  return <RNText {...props} style={[typography[variant] as TextStyle, { color }, align ? { textAlign: align } : null, weight ? { fontWeight: weight } : null, style]} />;
}

// -----------------------------------------------------------------------------
// Botões
// -----------------------------------------------------------------------------

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success';

export interface ButtonProps extends Omit<PressableProps, 'style' | 'children'> {
  title: string;
  variant?: ButtonVariant;
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  icon?: IconName;
  fullWidth?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function Button({ title, variant = 'primary', size = 'md', loading, icon, fullWidth, disabled, style, ...props }: ButtonProps) {
  const colors = useColors();
  const palette: Record<ButtonVariant, { bg: string; pressed: string; fg: string; border?: string }> = {
    primary: { bg: colors.brand, pressed: colors.brandPressed, fg: colors.onBrand },
    secondary: { bg: colors.surface, pressed: colors.surface2, fg: colors.fg, border: colors.border },
    ghost: { bg: 'transparent', pressed: colors.surface2, fg: colors.brand },
    danger: { bg: colors.danger, pressed: colors.danger, fg: '#ffffff' },
    success: { bg: colors.success, pressed: colors.success, fg: '#ffffff' },
  };
  const scheme = palette[variant];
  const height = size === 'sm' ? 36 : size === 'lg' ? 54 : 48;
  const inactive = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!inactive, busy: !!loading }}
      disabled={inactive}
      style={({ pressed }) => [
        {
          minHeight: height,
          paddingHorizontal: size === 'sm' ? space(3) : space(5),
          borderRadius: radius.md,
          backgroundColor: pressed ? scheme.pressed : scheme.bg,
          borderWidth: scheme.border ? 1 : 0,
          borderColor: scheme.border,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: space(2),
          opacity: inactive ? 0.55 : pressed && (variant === 'danger' || variant === 'success') ? 0.85 : 1,
          alignSelf: fullWidth ? 'stretch' : undefined,
        },
        style,
      ]}
      {...props}
    >
      {loading ? <ActivityIndicator color={scheme.fg} /> : icon ? <Icon name={icon} size={size === 'sm' ? 16 : 20} color={scheme.fg} /> : null}
      <RNText style={{ color: scheme.fg, fontSize: size === 'lg' ? 17 : size === 'sm' ? 14 : 16, fontWeight: '700' }} numberOfLines={1}>
        {title}
      </RNText>
    </Pressable>
  );
}

export function IconButton({ icon, onPress, label, color, size = 22, disabled }: { icon: IconName; onPress: () => void; label: string; color?: string; size?: number; disabled?: boolean }) {
  const colors = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      disabled={disabled}
      hitSlop={8}
      style={({ pressed }) => ({ padding: space(2), borderRadius: radius.full, backgroundColor: pressed ? colors.surface2 : 'transparent', opacity: disabled ? 0.4 : 1 })}
    >
      <Icon name={icon} size={size} color={color} />
    </Pressable>
  );
}

// -----------------------------------------------------------------------------
// Campos
// -----------------------------------------------------------------------------

export interface FieldProps extends TextInputProps {
  label?: string;
  error?: string | null;
  hint?: string;
  /** Senha com botão de mostrar/ocultar. */
  secure?: boolean;
  right?: ReactNode;
  containerStyle?: StyleProp<ViewStyle>;
}

export const Field = forwardRef<TextInput, FieldProps>(function Field({ label, error, hint, secure, right, containerStyle, style, editable = true, multiline, ...props }, ref) {
  const colors = useColors();
  const [focused, setFocused] = useState(false);
  const [hidden, setHidden] = useState(true);
  return (
    <View style={[{ gap: space(1.5) }, containerStyle]}>
      {label ? <Text variant="label">{label}</Text> : null}
      <View
        style={{
          flexDirection: 'row',
          alignItems: multiline ? 'flex-start' : 'center',
          minHeight: 50,
          borderRadius: radius.md,
          borderWidth: focused ? 2 : 1,
          borderColor: error ? colors.danger : focused ? colors.brand : colors.border,
          backgroundColor: editable ? colors.surface : colors.surface2,
          paddingHorizontal: space(3),
        }}
      >
        <TextInput
          ref={ref}
          placeholderTextColor={colors.muted}
          editable={editable}
          multiline={multiline}
          secureTextEntry={secure ? hidden : undefined}
          onFocus={(event) => {
            setFocused(true);
            props.onFocus?.(event);
          }}
          onBlur={(event) => {
            setFocused(false);
            props.onBlur?.(event);
          }}
          style={[{ flex: 1, color: colors.fg, fontSize: 16, paddingVertical: space(3), minHeight: multiline ? 96 : undefined, textAlignVertical: multiline ? 'top' : 'center' }, style]}
          accessibilityLabel={label}
          {...props}
        />
        {secure ? <IconButton icon={hidden ? 'eye' : 'eyeOff'} label={hidden ? 'Mostrar senha' : 'Ocultar senha'} onPress={() => setHidden((value) => !value)} size={20} color={colors.muted} /> : null}
        {right}
      </View>
      {error ? (
        <Text variant="caption" tone="danger" accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : hint ? (
        <Text variant="caption" tone="muted">
          {hint}
        </Text>
      ) : null}
    </View>
  );
});

// -----------------------------------------------------------------------------
// Estrutura
// -----------------------------------------------------------------------------

export function Card({ children, style, onPress, padded = true }: { children: ReactNode; style?: StyleProp<ViewStyle>; onPress?: () => void; padded?: boolean }) {
  const colors = useColors();
  const base: ViewStyle = { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: padded ? space(4) : 0 };
  if (!onPress) return <View style={[base, style]}>{children}</View>;
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [base, pressed ? { backgroundColor: colors.surface2 } : null, style]}>
      {children}
    </Pressable>
  );
}

export function Row({ children, gap = 2, style, align = 'center', justify }: { children: ReactNode; gap?: number; style?: StyleProp<ViewStyle>; align?: ViewStyle['alignItems']; justify?: ViewStyle['justifyContent'] }) {
  return <View style={[{ flexDirection: 'row', alignItems: align, justifyContent: justify, gap: space(gap) }, style]}>{children}</View>;
}

export function Stack({ children, gap = 3, style }: { children: ReactNode; gap?: number; style?: StyleProp<ViewStyle> }) {
  return <View style={[{ gap: space(gap) }, style]}>{children}</View>;
}

export function Divider({ style }: { style?: StyleProp<ViewStyle> }) {
  const colors = useColors();
  return <View style={[{ height: 1, backgroundColor: colors.border }, style]} />;
}

export function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <View style={{ gap: space(3) }}>
      <Row justify="space-between">
        <Text variant="heading">{title}</Text>
        {action}
      </Row>
      {children}
    </View>
  );
}

export function Badge({ label, tone = 'neutral' }: { label: string; tone?: Tone }) {
  const colors = useColors();
  const color = toneColor(colors, tone);
  return (
    <View style={{ alignSelf: 'flex-start', paddingHorizontal: space(2), paddingVertical: 2, borderRadius: radius.full, backgroundColor: `${color}22` }}>
      <RNText style={{ color, fontSize: 12, fontWeight: '700' }}>{label}</RNText>
    </View>
  );
}

/** Linha de valor: rótulo à esquerda, valor à direita (resumos de pedido, extratos). */
export function ValueRow({ label, value, strong, tone }: { label: string; value: string; strong?: boolean; tone?: Tone }) {
  return (
    <Row justify="space-between">
      <Text variant={strong ? 'subheading' : 'body'} tone={strong ? 'default' : 'muted'}>
        {label}
      </Text>
      <Text variant={strong ? 'subheading' : 'body'} tone={tone ?? 'default'} style={{ fontVariant: ['tabular-nums'] }}>
        {value}
      </Text>
    </Row>
  );
}
