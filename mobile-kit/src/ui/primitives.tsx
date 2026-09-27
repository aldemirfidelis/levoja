import { forwardRef, ReactNode, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
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
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { fontFamilies, fontFor, radius, space, toneColor, typography, useColors, type Tone, type TypographyVariant } from '../theme';
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

/**
 * Estilo de fonte da marca (Nunito) para um peso: a família já carrega o peso, então `fontWeight`
 * volta a 'normal' (no Android, peso + família customizada gera um negrito sintético por cima).
 */
export function fontStyleFor(weight?: TextStyle['fontWeight'] | null, italic?: boolean): TextStyle {
  const fontFamily = fontFor(weight, italic);
  return { fontFamily, fontWeight: 'normal', fontStyle: italic && fontFamily !== fontFamilies['900italic'] ? 'italic' : 'normal' };
}

export function Text({ variant = 'body', tone = 'default', align, weight, style, ...props }: TextProps) {
  const colors = useColors();
  const color = tone === 'default' ? colors.fg : tone === 'muted' ? colors.muted : tone === 'onBrand' ? colors.onBrand : toneColor(colors, tone);
  const base = typography[variant] as TextStyle;
  const own = StyleSheet.flatten(style) as TextStyle | undefined;
  const font = fontStyleFor(own?.fontWeight ?? weight ?? base.fontWeight, (own?.fontStyle ?? base.fontStyle) === 'italic');
  return <RNText {...props} style={[base, { color }, align ? { textAlign: align } : null, style, font]} />;
}

// -----------------------------------------------------------------------------
// Botões
// -----------------------------------------------------------------------------

type ButtonVariant = 'primary' | 'secondary' | 'dark' | 'ghost' | 'danger' | 'success';

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
    // Principal da marca: degradê laranja → pimenta (desenhado abaixo), texto Nunito 900 itálico.
    primary: { bg: colors.brand, pressed: colors.brandPressed, fg: colors.onBrand },
    secondary: { bg: colors.surface, pressed: colors.surface2, fg: colors.fg, border: colors.border },
    // Secundário da marca: azul-noite.
    dark: { bg: colors.noite, pressed: colors.noite, fg: colors.onNoite },
    ghost: { bg: 'transparent', pressed: colors.surface2, fg: colors.brand },
    danger: { bg: colors.danger, pressed: colors.danger, fg: '#ffffff' },
    success: { bg: colors.success, pressed: colors.success, fg: '#ffffff' },
  };
  const scheme = palette[variant];
  const gradient = variant === 'primary';
  const height = size === 'sm' ? 36 : size === 'lg' ? 54 : 50;
  const corner = size === 'sm' ? radius.md : radius.lg;
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
          borderRadius: corner,
          backgroundColor: gradient ? colors.ctaTo : pressed ? scheme.pressed : scheme.bg,
          borderWidth: scheme.border ? 1 : 0,
          borderColor: scheme.border,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: space(2),
          opacity: inactive ? 0.55 : pressed && variant !== 'secondary' && variant !== 'ghost' ? 0.88 : 1,
          alignSelf: fullWidth ? 'stretch' : undefined,
          overflow: gradient ? 'hidden' : undefined,
        },
        gradient && !inactive ? { shadowColor: '#F04A1A', shadowOpacity: 0.3, shadowRadius: 7, shadowOffset: { width: 0, height: 6 }, elevation: 4 } : null,
        style,
      ]}
      {...props}
    >
      {gradient ? <ButtonGradient from={colors.ctaFrom} to={colors.ctaTo} corner={corner} /> : null}
      {loading ? <ActivityIndicator color={scheme.fg} /> : icon ? <Icon name={icon} size={size === 'sm' ? 16 : 20} color={scheme.fg} /> : null}
      <RNText style={[{ color: scheme.fg, fontSize: size === 'lg' ? 17 : size === 'sm' ? 14 : 16 }, fontStyleFor(gradient ? '900' : '800', gradient)]} numberOfLines={1}>
        {title}
      </RNText>
    </Pressable>
  );
}

/** Fundo em degradê (135°) do botão principal. */
function ButtonGradient({ from, to, corner }: { from: string; to: string; corner: number }) {
  return (
    <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
      <Defs>
        <LinearGradient id="lj-cta" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor={from} />
          <Stop offset="1" stopColor={to} />
        </LinearGradient>
      </Defs>
      <Rect width="100%" height="100%" rx={corner} ry={corner} fill="url(#lj-cta)" />
    </Svg>
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
          style={[{ flex: 1, color: colors.fg, fontSize: 16, fontFamily: fontFor(400), paddingVertical: space(3), minHeight: multiline ? 96 : undefined, textAlignVertical: multiline ? 'top' : 'center' }, style]}
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
      <RNText style={[{ color, fontSize: 12 }, fontStyleFor('800')]}>{label}</RNText>
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
