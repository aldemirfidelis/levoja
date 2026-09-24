'use client';

import { use } from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { DeliveryDetail } from '@/components/delivery-detail';

export default function DeliveryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <>
      <Link href="/entregas" className="mb-4 inline-flex items-center gap-1 text-sm text-muted hover:text-fg">
        <ArrowLeft className="h-4 w-4" /> Minhas entregas
      </Link>
      <DeliveryDetail path={`deliveries/${id}`} />
    </>
  );
}
