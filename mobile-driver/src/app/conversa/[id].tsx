import { Stack, useLocalSearchParams } from 'expo-router';
import { ChatScreen } from '@levoja/mobile-kit';

export default function ConversationRoute() {
  const { id, title } = useLocalSearchParams<{ id: string; title?: string }>();
  return (
    <>
      <Stack.Screen options={{ title: title || 'Conversa' }} />
      <ChatScreen conversationId={id} />
    </>
  );
}
