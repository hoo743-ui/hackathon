import React from 'react';
import { Modal, Pressable, Text, View } from 'react-native';
import { useTheme } from '../theme/useTheme';
import { Button, type ButtonVariant } from './primitives';

/** 확인 대화상자 (RN Alert 는 웹에서 동작하지 않으므로 직접 그린다). */
export function ConfirmDialog({
  visible,
  title,
  body,
  confirmLabel,
  confirmVariant = 'primary',
  onConfirm,
  onCancel,
}: {
  visible: boolean;
  title: string;
  body: string;
  confirmLabel: string;
  confirmVariant?: ButtonVariant;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { c, t, space, radius } = useTheme();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel} statusBarTranslucent>
      <Pressable accessibilityLabel="닫기" onPress={onCancel} style={{ flex: 1, backgroundColor: c.scrim, justifyContent: 'center', padding: space.s5 }}>
        <Pressable
          accessibilityViewIsModal
          onPress={() => undefined}
          style={{ backgroundColor: c.surface, borderRadius: radius.panel, borderTopWidth: 2, borderTopColor: c.ruleStrong, padding: space.s5, gap: space.s4, maxWidth: 420, width: '100%', alignSelf: 'center' }}
        >
          <Text accessibilityRole="header" style={[t.title, { color: c.ink }]}>
            {title}
          </Text>
          <Text style={[t.body, { color: c.ink2 }]}>{body}</Text>
          <View style={{ flexDirection: 'row', gap: space.s2 }}>
            <Button label="취소" onPress={onCancel} style={{ flex: 1 }} />
            <Button label={confirmLabel} variant={confirmVariant} onPress={onConfirm} style={{ flex: 1 }} />
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
