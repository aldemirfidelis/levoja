import { router } from 'expo-router';
import { LoginScreen } from '@levoja/mobile-kit';

export default function SignIn() {
  return (
    <LoginScreen
      title="Pediu? Já levo!"
      subtitle="Entre para pedir das lojas perto de você e enviar entregas."
      onForgot={() => router.push('/esqueci-senha')}
      onRegister={() => router.push('/cadastro')}
    />
  );
}
