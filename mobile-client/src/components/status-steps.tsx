import { View } from 'react-native';
import { Row, space, Text, useColors } from '@levoja/mobile-kit';

/** Linha do tempo resumida (etapas concluídas destacadas). */
export function StatusSteps({ steps, current }: { steps: string[]; current: number }) {
  const colors = useColors();
  return (
    <View style={{ gap: space(2) }}>
      <Row gap={1}>
        {steps.map((step, index) => (
          <View key={step} style={{ flex: 1, height: 5, borderRadius: 3, backgroundColor: index <= current ? colors.brand : colors.border }} />
        ))}
      </Row>
      <Text variant="caption" tone="muted">
        {steps[Math.max(0, Math.min(current, steps.length - 1))]}
      </Text>
    </View>
  );
}
