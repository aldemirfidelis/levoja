import { router } from 'expo-router';
import { ForgotPasswordScreen } from '@levoja/mobile-kit';

export default function ForgotPassword() {
  return <ForgotPasswordScreen onDone={() => router.back()} />;
}
