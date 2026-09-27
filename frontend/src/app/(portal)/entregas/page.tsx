'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';
import { PageHeader } from '@levoja/web-kit/ui';
import { DeliveriesList } from '@/components/deliveries-list';

export default function MyDeliveriesPage() {
  const router = useRouter();
  const newButton = (
    <Link href="/entregas/nova" className="inline-flex h-10 items-center gap-2 rounded-xl bg-cta-gradient px-4 text-sm font-black italic text-white shadow-[0_6px_14px_rgba(240,74,26,0.3)] hover:brightness-105">
      <Plus className="h-4 w-4" /> Pedir uma entrega
    </Link>
  );
  return (
    <>
      <PageHeader title="Minhas entregas" description="Envie documentos, encomendas e presentes de um ponto a outro." actions={newButton} />
      <DeliveriesList path="deliveries" onOpen={(delivery) => router.push(`/entregas/${delivery.id}`)} emptyAction={newButton} />
    </>
  );
}
