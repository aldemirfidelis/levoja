import type { Metadata } from 'next';
import { BadgeCheck, EyeOff, FileLock2, KeyRound, MessageSquareLock, ScrollText } from 'lucide-react';
import { FeatureGrid, PageHero, Section } from '@/components/marketing';

export const metadata: Metadata = { title: 'Segurança' };

export default function SecurityPage() {
  return (
    <>
      <PageHero eyebrow="Segurança" title="Proteção para quem compra, vende e entrega" description="Segurança e privacidade fazem parte do produto desde o primeiro dia." />
      <Section>
        <FeatureGrid
          items={[
            { icon: <BadgeCheck className="h-6 w-6" />, title: 'Verificação de parceiros', text: 'Empresas e entregadores só operam após análise de documentos pela nossa equipe.' },
            { icon: <FileLock2 className="h-6 w-6" />, title: 'Dados criptografados', text: 'CPF, CNH e dados bancários são armazenados com criptografia forte.' },
            { icon: <MessageSquareLock className="h-6 w-6" />, title: 'Telefone protegido', text: 'A conversa acontece pelo chat da plataforma, sem expor números pessoais.' },
            { icon: <KeyRound className="h-6 w-6" />, title: 'Verificação em duas etapas', text: 'Ative um código do app autenticador para proteger sua conta.' },
            { icon: <EyeOff className="h-6 w-6" />, title: 'Mínimo necessário', text: 'Cada participante vê apenas os dados indispensáveis para a entrega.' },
            { icon: <ScrollText className="h-6 w-6" />, title: 'Seus direitos (LGPD)', text: 'Exporte seus dados, gerencie consentimentos ou solicite a exclusão da conta quando quiser.' },
          ]}
        />
      </Section>
    </>
  );
}
