import { router } from 'expo-router';
import { LoginScreen } from '@levoja/mobile-kit';

export default function SignIn() {
  return (
    <LoginScreen
      title="LevoJá Entregador"
      subtitle="Faça entregas no seu horário e receba via PIX."
      logo={require('../../../assets/logo.png')}
      onForgot={() => router.push('/esqueci-senha')}
      onRegister={() => router.push('/cadastro')}
      registerLabel="Quero ser entregador"
    />
  );
}
