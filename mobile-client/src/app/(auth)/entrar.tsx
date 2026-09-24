import { router } from 'expo-router';
import { LoginScreen } from '@levoja/mobile-kit';

export default function SignIn() {
  return (
    <LoginScreen
      title="Tudo o que você precisa, levado já."
      subtitle="Entre para pedir das lojas perto de você e enviar entregas."
      logo={require('../../../assets/logo.png')}
      onForgot={() => router.push('/esqueci-senha')}
      onRegister={() => router.push('/cadastro')}
    />
  );
}
