import { Pressable, View } from 'react-native';
import { Icon, Row, useColors } from '@levoja/mobile-kit';

export function RatingInput({ value, onChange, size = 32 }: { value: number; onChange: (value: number) => void; size?: number }) {
  const colors = useColors();
  return (
    <View accessibilityHint={`Nota atual: ${value} de 5`}>
    <Row gap={2}>
      {[1, 2, 3, 4, 5].map((star) => (
        <Pressable key={star} onPress={() => onChange(star)} accessibilityRole="button" accessibilityLabel={`${star} estrela${star > 1 ? 's' : ''}`} hitSlop={6}>
          <Icon name="star" size={size} color={star <= value ? colors.warning : colors.border} />
        </Pressable>
      ))}
    </Row>
    </View>
  );
}
