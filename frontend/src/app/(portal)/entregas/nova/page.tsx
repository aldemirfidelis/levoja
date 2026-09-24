'use client';

import { useRouter } from 'next/navigation';
import { PageHeader, useToast } from '@levoja/web-kit/ui';
import { DeliveryRequestForm } from '@/components/delivery-request';

export default function NewDeliveryPage() {
  const router = useRouter();
  const toast = useToast();
  return (
    <>
      <PageHeader title="Pedir uma entrega" description="Informe origem, destino e o que será enviado. Você vê o valor antes de confirmar." />
      <DeliveryRequestForm
        basePath="deliveries"
        onCreated={(id) => {
          toast.success('Entrega solicitada! Estamos procurando um entregador.');
          router.replace(`/entregas/${id}`);
        }}
      />
    </>
  );
}
