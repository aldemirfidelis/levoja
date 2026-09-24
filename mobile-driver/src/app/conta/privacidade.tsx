import { PrivacyScreen } from '@levoja/mobile-kit';

export default function Privacy() {
  return <PrivacyScreen extraDocuments={[{ label: 'Termos do Entregador', path: '/termos-entregador' }]} />;
}
