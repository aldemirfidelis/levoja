'use client';

import { Copy, Gift, Share2 } from 'lucide-react';
import { formatBRL, REFERRAL_PROGRAM_LABELS, REFERRAL_STATUS_LABELS, type ReferralProgram, type ReferralStatus } from '@levoja/shared';
import { useApi } from '@levoja/web-kit/client';
import { Badge, Button, Card, EmptyState, ErrorState, formatDate, SkeletonRows, StatCard, useToast, type Tone } from '@levoja/web-kit/ui';

interface ReferralRow {
  id: string;
  program: ReferralProgram;
  name: string;
  status: ReferralStatus;
  rewardCents: number;
  expiresAt: string;
  rewardedAt: string | null;
  createdAt: string;
}

type MyReferrals =
  | { enabled: false }
  | {
      enabled: true;
      code: string;
      programEnabled: boolean;
      referrerRewardCents: number;
      referredRewardCents: number;
      goal: string;
      programs: { program: ReferralProgram; referrerRewardCents: number; referredRewardCents: number; goal: string }[];
      stats: { total: number; pending: number; rewarded: number; earnedCents: number };
      referrals: ReferralRow[];
    };

const STATUS_TONE: Record<ReferralStatus, Tone> = { PENDING: 'warning', REWARDED: 'success', REJECTED: 'danger', EXPIRED: 'neutral' };
const SIGNUP_PATH: Record<ReferralProgram, string> = { CUSTOMER: '/cadastro/cliente', DRIVER: '/cadastro/entregador', COMPANY: '/cadastro/empresa' };
const lower = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);

/** Indique e ganhe: código, link de convite, regras e indicações feitas (só o primeiro nome de quem foi indicado). */
export function ReferralPanel({ program, walletHint }: { program: ReferralProgram; walletHint: string }) {
  const toast = useToast();
  const query = useApi<MyReferrals>('referrals/me', { program });
  if (query.isLoading) return <SkeletonRows />;
  if (query.error || !query.data) return <ErrorState error={query.error} onRetry={() => query.refetch()} />;
  const data = query.data;
  if (!data.enabled) return <EmptyState icon={<Gift className="h-8 w-8" />} title="Indique e ganhe indisponível" description="O programa de indicação não está ativo no momento." />;

  const link = `${typeof window === 'undefined' ? '' : window.location.origin}/convite/${data.code}`;
  const copy = (text: string, message: string) =>
    navigator.clipboard
      .writeText(text)
      .then(() => toast.success(message))
      .catch(() => toast.info(text));
  const share = () => {
    const text = `Use meu código ${data.code} no cadastro${data.referredRewardCents ? ` e ganhe ${formatBRL(data.referredRewardCents)}` : ''}.`;
    if (navigator.share) void navigator.share({ title: 'Convite', text, url: link }).catch(() => undefined);
    else copy(`${text} ${link}`, 'Convite copiado.');
  };

  return (
    <div className="space-y-6">
      <Card title="Seu convite">
        <div className="grid gap-6 md:grid-cols-[1fr_auto] md:items-center">
          <div className="space-y-2">
            {data.programEnabled ? (
              <p className="text-fg">
                Você ganha <strong>{formatBRL(data.referrerRewardCents)}</strong> por indicação de {REFERRAL_PROGRAM_LABELS[program].toLowerCase()}
                {data.referredRewardCents ? (
                  <>
                    {' '}
                    e quem você indicar ganha <strong>{formatBRL(data.referredRewardCents)}</strong>
                  </>
                ) : null}
                .
              </p>
            ) : (
              <p className="text-muted">Indicações deste tipo estão pausadas; seu código continua valendo nos outros programas.</p>
            )}
            <p className="text-sm text-muted">Meta para liberar: {lower(data.goal)}. {walletHint}</p>
            {data.programs
              .filter((item) => item.program !== program)
              .map((item) => (
                <p key={item.program} className="text-sm text-muted">
                  Também vale para {REFERRAL_PROGRAM_LABELS[item.program].toLowerCase()}: {formatBRL(item.referrerRewardCents)} ({lower(item.goal)}) —{' '}
                  <a className="text-brand-600 hover:underline" href={`${SIGNUP_PATH[item.program]}?indicacao=${data.code}`}>
                    link de cadastro
                  </a>
                </p>
              ))}
          </div>
          <div className="flex flex-col items-center gap-3 rounded-xl border-2 border-dashed border-brand-500 px-8 py-4">
            <span className="text-xs uppercase tracking-wide text-muted">Seu código</span>
            <span className="font-mono text-3xl font-extrabold tracking-widest text-fg">{data.code}</span>
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" icon={<Copy className="h-4 w-4" />} onClick={() => copy(data.code, 'Código copiado.')}>
                Copiar
              </Button>
              <Button size="sm" icon={<Share2 className="h-4 w-4" />} onClick={share}>
                Compartilhar
              </Button>
            </div>
          </div>
        </div>
      </Card>

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Indicações" value={data.stats.total} />
        <StatCard label="Aguardando a meta" value={data.stats.pending} tone="warning" />
        <StatCard label="Você ganhou" value={formatBRL(data.stats.earnedCents)} tone="success" />
      </div>

      <Card title="Suas indicações">
        {data.referrals.length === 0 ? (
          <p className="text-sm text-muted">Ninguém se cadastrou com o seu código ainda.</p>
        ) : (
          <ul className="divide-y divide-border">
            {data.referrals.map((row) => (
              <li key={row.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div>
                  <p className="font-medium">
                    {row.name} <span className="text-sm font-normal text-muted">· {REFERRAL_PROGRAM_LABELS[row.program]}</span>
                  </p>
                  <p className="text-sm text-muted">
                    {row.status === 'PENDING' ? `Prazo até ${formatDate(row.expiresAt)}` : row.rewardedAt ? `Pago em ${formatDate(row.rewardedAt)}` : `Cadastro em ${formatDate(row.createdAt)}`}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  {row.status === 'REWARDED' && <span className="font-semibold text-success">+{formatBRL(row.rewardCents)}</span>}
                  <Badge tone={STATUS_TONE[row.status]}>{REFERRAL_STATUS_LABELS[row.status]}</Badge>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
