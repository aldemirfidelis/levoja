import { ReactNode } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { radius, space, useColors } from '../theme';
import { IconButton, Row, Text } from './primitives';

/** Painel inferior modal (seleções, formulários curtos, detalhes). */
export function Sheet({ visible, onClose, title, children, footer }: { visible: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode }) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <Pressable style={{ flex: 1, backgroundColor: colors.overlay }} onPress={onClose} accessibilityLabel="Fechar" />
        <View style={{ backgroundColor: colors.surface, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, maxHeight: '88%', paddingBottom: insets.bottom + space(3) }}>
          <Row justify="space-between" style={{ paddingHorizontal: space(4), paddingTop: space(3) }}>
            <Text variant="heading" style={{ flex: 1 }}>
              {title}
            </Text>
            <IconButton icon="close" label="Fechar" onPress={onClose} />
          </Row>
          <ScrollView contentContainerStyle={{ padding: space(4), gap: space(3) }} keyboardShouldPersistTaps="handled">
            {children}
          </ScrollView>
          {footer ? <View style={{ paddingHorizontal: space(4), gap: space(2) }}>{footer}</View> : null}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
