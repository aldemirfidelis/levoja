'use client';

import { useApi } from '@levoja/web-kit/client';
import { ChangePasswordCard, PageHeader, SessionsCard, TwoFactorCard } from '@levoja/web-kit/ui';
import { useSession } from '@/lib/session';

export default function AccountPage() {
  const { me } = useSession();
  const { data, refetch } = useApi<{ user: { mfaEnabled: boolean } }>('auth/me');
  return (
    <>
      <PageHeader title="Minha conta" description={`${me.user.name} · ${me.user.email}`} />
      <div className="grid gap-6 xl:grid-cols-2">
        <TwoFactorCard enabled={data?.user.mfaEnabled ?? me.user.mfaEnabled} onChange={() => refetch()} />
        <ChangePasswordCard />
        <div className="xl:col-span-2">
          <SessionsCard />
        </div>
      </div>
    </>
  );
}
