import { forwardRef, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { PanResponder, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { captureRef } from 'react-native-view-shot';
import { radius, useColors } from '@levoja/mobile-kit';

export interface SignaturePadHandle {
  clear(): void;
  /** Gera um PNG da assinatura (arquivo temporário) — null se estiver vazia. */
  capture(): Promise<string | null>;
  isEmpty(): boolean;
}

/** Área de assinatura com o dedo (traços em SVG, exportados como imagem PNG). */
export const SignaturePad = forwardRef<SignaturePadHandle, { height?: number; onChange?: (hasInk: boolean) => void }>(function SignaturePad({ height = 220, onChange }, ref) {
  const colors = useColors();
  const view = useRef<View>(null);
  const [paths, setPaths] = useState<string[]>([]);
  const [current, setCurrent] = useState('');
  const drawing = useRef('');

  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onStartShouldSetPanResponderCapture: () => true,
        onMoveShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponderCapture: () => true,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: (event) => {
          const { locationX, locationY } = event.nativeEvent;
          drawing.current = `M${locationX.toFixed(1)},${locationY.toFixed(1)}`;
          setCurrent(drawing.current);
        },
        onPanResponderMove: (event) => {
          const { locationX, locationY } = event.nativeEvent;
          drawing.current += ` L${locationX.toFixed(1)},${locationY.toFixed(1)}`;
          setCurrent(drawing.current);
        },
        onPanResponderRelease: () => {
          const stroke = drawing.current;
          drawing.current = '';
          setCurrent('');
          if (stroke.includes('L')) {
            setPaths((list) => [...list, stroke]);
            onChange?.(true);
          }
        },
      }),
    [onChange],
  );

  useImperativeHandle(ref, () => ({
    clear: () => {
      setPaths([]);
      onChange?.(false);
    },
    isEmpty: () => paths.length === 0,
    capture: async () => (paths.length ? captureRef(view, { format: 'png', quality: 0.9, result: 'tmpfile' }) : null),
  }));

  return (
    <View
      ref={view}
      collapsable={false}
      {...responder.panHandlers}
      style={{ height, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: '#ffffff', overflow: 'hidden' }}
      accessibilityLabel="Área para assinatura"
    >
      <Svg width="100%" height="100%">
        {[...paths, current].filter(Boolean).map((d, index) => (
          <Path key={index} d={d} stroke="#111827" strokeWidth={3} fill="none" strokeLinecap="round" strokeLinejoin="round" />
        ))}
      </Svg>
    </View>
  );
});
