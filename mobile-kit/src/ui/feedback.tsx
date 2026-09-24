import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Animated, Modal, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import NetInfo from '@react-native-community/netinfo';
import { ApiError, errorMessage } from '../api';
import { radius, space, useColors } from '../theme';
import { Icon, type IconName } from './icon';
import { Button, Field, Row, Text } from './primitives';

export function Loading({ label }: { label?: string }) {
  const colors = useColors();
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: space(8), gap: space(3) }} accessibilityRole="progressbar">
      <ActivityIndicator size="large" color={colors.brand} />
      {label ? <Text tone="muted">{label}</Text> : null}
    </View>
  );
}

export function EmptyState({ icon = 'info', title, description, action }: { icon?: IconName; title: string; description?: string; action?: ReactNode }) {
  const colors = useColors();
  return (
    <View style={{ alignItems: 'center', justifyContent: 'center', padding: space(8), gap: space(3) }}>
      <View style={{ width: 64, height: 64, borderRadius: radius.full, backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={icon} size={30} color={colors.muted} />
      </View>
      <Text variant="subheading" align="center">
        {title}
      </Text>
      {description ? (
        <Text tone="muted" align="center">
          {description}
        </Text>
      ) : null}
      {action}
    </View>
  );
}

export function ErrorView({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const offline = error instanceof ApiError && error.offline;
  return (
    <EmptyState
      icon={offline ? 'offline' : 'alert'}
      title={offline ? 'Sem conexão' : 'Algo deu errado'}
      description={errorMessage(error)}
      action={onRetry ? <Button title="Tentar novamente" variant="secondary" icon="refresh" onPress={onRetry} /> : undefined}
    />
  );
}

/** Aviso fixo quando o aparelho está sem internet. */
export function OfflineBanner({ message = 'Sem internet. Algumas ações ficarão pendentes até a conexão voltar.' }: { message?: string }) {
  const colors = useColors();
  const [offline, setOffline] = useState(false);
  useEffect(() => NetInfo.addEventListener((state) => setOffline(state.isConnected === false || state.isInternetReachable === false)), []);
  if (!offline) return null;
  return (
    <Row gap={2} style={{ backgroundColor: colors.warning, paddingHorizontal: space(4), paddingVertical: space(2) }}>
      <Icon name="offline" size={18} color="#ffffff" />
      <Text variant="caption" style={{ color: '#ffffff', flex: 1 }}>
        {message}
      </Text>
    </Row>
  );
}

// -----------------------------------------------------------------------------
// Toast
// -----------------------------------------------------------------------------

type ToastKind = 'success' | 'error' | 'info';
interface ToastApi {
  success: (message: string) => void;
  error: (error: unknown) => void;
  info: (message: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [toast, setToast] = useState<{ kind: ToastKind; message: string; id: number } | null>(null);
  const opacity = useRef(new Animated.Value(0)).current;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback(
    (kind: ToastKind, message: string) => {
      if (timer.current) clearTimeout(timer.current);
      setToast({ kind, message, id: Date.now() });
      Animated.timing(opacity, { toValue: 1, duration: 180, useNativeDriver: true }).start();
      timer.current = setTimeout(() => {
        Animated.timing(opacity, { toValue: 0, duration: 220, useNativeDriver: true }).start(() => setToast(null));
      }, kind === 'error' ? 4500 : 2800);
    },
    [opacity],
  );

  const api = useMemo<ToastApi>(
    () => ({
      success: (message) => show('success', message),
      error: (error) => show('error', errorMessage(error)),
      info: (message) => show('info', message),
    }),
    [show],
  );

  const background = toast?.kind === 'success' ? colors.success : toast?.kind === 'error' ? colors.danger : colors.fg;
  return (
    <ToastContext.Provider value={api}>
      {children}
      {toast ? (
        <Animated.View
          pointerEvents="box-none"
          style={{ position: 'absolute', left: space(4), right: space(4), top: insets.top + space(2), opacity }}
          accessibilityLiveRegion="polite"
          accessibilityRole="alert"
        >
          <Pressable onPress={() => setToast(null)} style={{ backgroundColor: background, borderRadius: radius.md, padding: space(3.5), flexDirection: 'row', gap: space(2), alignItems: 'center' }}>
            <Icon name={toast.kind === 'success' ? 'checkCircle' : toast.kind === 'error' ? 'alert' : 'info'} size={20} color={colors.bg} />
            <Text style={{ color: colors.bg, flex: 1 }} weight="600">
              {toast.message}
            </Text>
          </Pressable>
        </Animated.View>
      ) : null}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const value = useContext(ToastContext);
  if (!value) throw new Error('ToastProvider ausente');
  return value;
}

// -----------------------------------------------------------------------------
// Confirmações
// -----------------------------------------------------------------------------

/** Confirmação nativa (Alert). Resolve true quando o usuário confirma. */
export function confirm(title: string, message: string, options: { confirmLabel?: string; destructive?: boolean } = {}): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(title, message, [
      { text: 'Voltar', style: 'cancel', onPress: () => resolve(false) },
      { text: options.confirmLabel ?? 'Confirmar', style: options.destructive ? 'destructive' : 'default', onPress: () => resolve(true) },
    ], { cancelable: true, onDismiss: () => resolve(false) });
  });
}

/** Janela com justificativa (cancelamentos, falhas, recusas). */
export function ReasonDialog({
  visible,
  title,
  description,
  placeholder,
  confirmLabel = 'Confirmar',
  destructive,
  options,
  onClose,
  onConfirm,
}: {
  visible: boolean;
  title: string;
  description?: string;
  placeholder?: string;
  confirmLabel?: string;
  destructive?: boolean;
  /** Motivos pré-definidos (opcional); "Outro" libera o texto livre. */
  options?: { value: string; label: string }[];
  onClose: () => void;
  onConfirm: (reason: string, option?: string) => Promise<void> | void;
}) {
  const colors = useColors();
  const [text, setText] = useState('');
  const [option, setOption] = useState<string | undefined>(options?.[0]?.value);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setText('');
      setError(null);
      setOption(options?.[0]?.value);
    }
  }, [visible, options]);

  const submit = async () => {
    const reason = text.trim() || options?.find((item) => item.value === option)?.label || '';
    if (reason.length < 3) return setError('Informe o motivo.');
    setBusy(true);
    try {
      await onConfirm(reason, option);
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: colors.overlay, justifyContent: 'center', padding: space(5) }}>
        <View style={{ backgroundColor: colors.surface, borderRadius: radius.lg, padding: space(5), gap: space(3) }}>
          <Text variant="heading">{title}</Text>
          {description ? <Text tone="muted">{description}</Text> : null}
          {options?.map((item) => (
            <Pressable key={item.value} onPress={() => setOption(item.value)} accessibilityRole="radio" accessibilityState={{ checked: option === item.value }}>
              <Row gap={2}>
                <Icon name={option === item.value ? 'checkCircle' : 'info'} size={20} color={option === item.value ? colors.brand : colors.border} />
                <Text>{item.label}</Text>
              </Row>
            </Pressable>
          ))}
          <Field value={text} onChangeText={setText} placeholder={placeholder ?? 'Descreva o motivo'} multiline maxLength={500} error={error} />
          <Row justify="flex-end" gap={2}>
            <Button title="Voltar" variant="secondary" onPress={onClose} />
            <Button title={confirmLabel} variant={destructive ? 'danger' : 'primary'} loading={busy} onPress={submit} />
          </Row>
        </View>
      </View>
    </Modal>
  );
}
