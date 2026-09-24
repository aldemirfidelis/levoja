'use client';

import { FormEvent, useState } from 'react';
import Link from 'next/link';
import { Ban, Flag, ShieldCheck, Smartphone } from 'lucide-react';
import { DELIVERY_STATUS_LABELS, ORDER_STATUS_LABELS, RISK_CASE_STATUS_LABELS, RISK_LEVEL_LABELS, RISK_SIGNAL_LABELS, type RiskCaseStatus, type RiskLevel, type RiskSignalType } from '@levoja/shared';
import { api } from '@levoja/web-kit/client';
import { Badge, Button, Card, ConfirmDialog, DescriptionList, Dialog, formatDate, formatDateTime, formatPhone, Input, Textarea, useToast } from '@levoja/web-kit/ui';
import { RISK_CASE_TONE, RISK_LEVEL_TONE } from '@/components/intelligence-nav';
import { useSession } from '@/lib/session';

export interface RiskUser {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  status: string;
  createdAt: string;
  customerId: string | null;
  driverId: string | null;
}

export interface RiskSignalRow {
  id: string;
  type: RiskSignalType;
  points: number;
  message: string;
  details: Record<string, unknown> | null;
  relatedUserIds: string[];
  orderId: string | null;
  deliveryId: string | null;
  orderNumber: number | null;
  deliveryCode: string | null;
  createdAt: string;
}

export interface RiskSubjectData {
  user: RiskUser;
  profile: { score: number; level: RiskLevel; signals: number; lastSignalAt: string | null; trustedUntil: string | null; trustedReason: string | null } | null;
  signals: RiskSignalRow[];
  devices: { id: string; fingerprint: string; firstSeenAt: string; lastSeenAt: string; logins: number; lastIp: string | null; userAgent: string | null }[];
  related: (RiskUser & { sharedDevice: boolean; score: number; level: RiskLevel })[];
  activity: { orders: Record<string, number>; deliveries: Record<string, number> };
  cases: { id: string; number: number; status: RiskCaseStatus; level: RiskLevel; score: number; createdAt: string; resolution: string | null }[];
}

const USER_STATUS: Record<string, string> = { ACTIVE: 'Ativa', SUSPENDED: 'Suspensa', BLOCKED: 'Bloqueada', DEACTIVATED: 'Desativada' };

/** Barra do score (0–100) com os limites de nível. */
export function ScoreMeter({ score, level }: { score: number; level: RiskLevel }) {
  const color = level === 'HIGH' ? 'var(--lj-danger)' : level === 'MEDIUM' ? 'var(--lj-warning)' : 'var(--lj-chart-1)';
  return (
    <div className="flex items-center gap-3">
      <span className="text-2xl font-semibold tabular-nums text-fg">{score}</span>
      <div className="h-2 w-40 overflow-hidden rounded-full bg-surface-2" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={score} aria-label="Score de risco">
        <div className="h-full rounded-full" style={{ width: `${score}%`, background: color }} />
      </div>
      <Badge tone={RISK_LEVEL_TONE[level]}>Risco {RISK_LEVEL_LABELS[level].toLowerCase()}</Badge>
    </div>
  );
}

function SignalDetails({ details }: { details: Record<string, unknown> | null }) {
  if (!details) return null;
  const entries = Object.entries(details).filter(([key, value]) => value != null && typeof value !== 'object' && key !== 'by');
  if (!entries.length) return null;
  return <p className="mt-1 text-xs text-muted">{entries.map(([key, value]) => `${key}: ${typeof value === 'number' ? value.toLocaleString('pt-BR') : String(value)}`).join(' · ')}</p>;
}

/** Links para o pedido e a entrega citados no sinal. */
export function SignalRefs({ signal }: { signal: Pick<RiskSignalRow, 'orderNumber' | 'deliveryCode'> }) {
  if (signal.orderNumber == null && !signal.deliveryCode) return null;
  return (
    <p className="mt-1 text-xs">
      {signal.orderNumber != null && (
        <Link href={`/pedidos?search=${signal.orderNumber}`} className="mr-3 text-brand-600 hover:underline">
          Pedido #{signal.orderNumber}
        </Link>
      )}
      {signal.deliveryCode && (
        <Link href={`/entregas?scope=&search=${signal.deliveryCode}`} className="text-brand-600 hover:underline">
          Entrega {signal.deliveryCode}
        </Link>
      )}
    </p>
  );
}

/**
 * Perfil de risco de uma conta: score, evidências (sinais), aparelhos, contas relacionadas e
 * atividade. As decisões ficam com a equipe: registrar sinal, bloquear (permissão própria).
 */
export function RiskSubjectView({ data, onChanged }: { data: RiskSubjectData; onChanged: () => void }) {
  const { can } = useSession();
  const toast = useToast();
  const [manual, setManual] = useState(false);
  const [blocking, setBlocking] = useState(false);
  const [message, setMessage] = useState('');
  const [points, setPoints] = useState(20);
  const [busy, setBusy] = useState(false);
  const related = new Map(data.related.map((user) => [user.id, user]));

  const addSignal = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      await api.post(`admin/intelligence/fraud/users/${data.user.id}/signals`, { message, points });
      toast.success('Sinal registrado.');
      setManual(false);
      setMessage('');
      onChanged();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };

  const revokeTrust = async () => {
    try {
      await api.post(`admin/intelligence/fraud/users/${data.user.id}/revoke-trust`);
      toast.success('Isenção removida: as ações automáticas voltam a valer.');
      onChanged();
    } catch (err) {
      toast.error(err);
    }
  };

  const trusted = data.profile?.trustedUntil && new Date(data.profile.trustedUntil) > new Date();
  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-2">
        <Card
          title="Conta"
          actions={
            <div className="flex flex-wrap gap-2">
              {can('fraud.manage') && (
                <Button size="sm" variant="secondary" icon={<Flag className="h-4 w-4" />} onClick={() => setManual(true)}>
                  Registrar sinal
                </Button>
              )}
              {can('users.status.manage') && data.user.status === 'ACTIVE' && (
                <Button size="sm" variant="ghost" className="text-danger" icon={<Ban className="h-4 w-4" />} onClick={() => setBlocking(true)}>
                  Bloquear conta
                </Button>
              )}
            </div>
          }
        >
          <DescriptionList
            items={[
              { label: 'Nome', value: data.user.name },
              { label: 'E-mail', value: data.user.email },
              { label: 'Telefone', value: data.user.phone ? formatPhone(data.user.phone) : '—' },
              { label: 'Perfis', value: [data.user.customerId && 'Cliente', data.user.driverId && 'Entregador'].filter(Boolean).join(' e ') || '—' },
              { label: 'Situação', value: <Badge tone={data.user.status === 'ACTIVE' ? 'success' : 'danger'}>{USER_STATUS[data.user.status] ?? data.user.status}</Badge> },
              { label: 'Conta criada em', value: formatDate(data.user.createdAt) },
            ]}
          />
          {data.user.driverId && can('drivers.read') && (
            <Link href={`/entregadores/${data.user.driverId}`} className="mt-3 inline-block text-sm text-brand-600 hover:underline">
              Ver cadastro de entregador
            </Link>
          )}
        </Card>
        <Card title="Score de risco">
          {data.profile ? (
            <div className="space-y-3 text-sm">
              <ScoreMeter score={data.profile.score} level={data.profile.level} />
              <p className="text-muted">
                {data.profile.signals} sinal(is) considerados · último em {formatDateTime(data.profile.lastSignalAt)}. O score perde metade do peso a cada meia-vida configurada.
              </p>
              {trusted && (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-success/40 bg-success/5 p-3">
                  <p className="flex items-center gap-1.5 text-fg">
                    <ShieldCheck className="h-4 w-4 text-success" aria-hidden /> Liberada pela equipe até {formatDate(data.profile.trustedUntil)}
                    {data.profile.trustedReason ? ` — ${data.profile.trustedReason}` : ''}
                  </p>
                  {can('fraud.manage') && (
                    <Button size="sm" variant="ghost" onClick={() => void revokeTrust()}>
                      Remover isenção
                    </Button>
                  )}
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted">Sem sinais de risco registrados.</p>
          )}
          <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
            <div>
              <p className="font-medium text-fg">Pedidos</p>
              <p className="text-muted">
                {Object.entries(data.activity.orders)
                  .map(([status, count]) => `${ORDER_STATUS_LABELS[status as keyof typeof ORDER_STATUS_LABELS] ?? status}: ${count}`)
                  .join(' · ') || '—'}
              </p>
            </div>
            <div>
              <p className="font-medium text-fg">Entregas (como entregador)</p>
              <p className="text-muted">
                {Object.entries(data.activity.deliveries)
                  .map(([status, count]) => `${DELIVERY_STATUS_LABELS[status as keyof typeof DELIVERY_STATUS_LABELS] ?? status}: ${count}`)
                  .join(' · ') || '—'}
              </p>
            </div>
          </div>
        </Card>
      </div>

      <Card title={`Evidências (${data.signals.length})`}>
        {data.signals.length === 0 ? (
          <p className="text-sm text-muted">Nenhum sinal.</p>
        ) : (
          <ol className="space-y-3">
            {data.signals.map((signal) => (
              <li key={signal.id} className="rounded-lg border border-border p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium text-fg">{RISK_SIGNAL_LABELS[signal.type]}</p>
                  <span className="text-xs text-muted">
                    +{signal.points} pts · {formatDateTime(signal.createdAt)}
                  </span>
                </div>
                <p className="mt-1 text-fg">{signal.message}</p>
                <SignalDetails details={signal.details} />
                {signal.relatedUserIds.length > 0 && (
                  <p className="mt-1 text-xs text-muted">
                    Contas relacionadas:{' '}
                    {signal.relatedUserIds.map((id, index) => (
                      <span key={id}>
                        {index > 0 && ', '}
                        <Link href={`/antifraude/contas/${id}`} className="text-brand-600 hover:underline">
                          {related.get(id)?.name ?? 'conta'}
                        </Link>
                      </span>
                    ))}
                  </p>
                )}
                <SignalRefs signal={signal} />
              </li>
            ))}
          </ol>
        )}
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title={`Contas relacionadas (${data.related.length})`}>
          {data.related.length === 0 ? (
            <p className="text-sm text-muted">Nenhuma conta ligada por aparelho ou evidência.</p>
          ) : (
            <ul className="divide-y divide-border text-sm">
              {data.related.map((user) => (
                <li key={user.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <div>
                    <Link href={`/antifraude/contas/${user.id}`} className="font-medium text-brand-600 hover:underline">
                      {user.name}
                    </Link>
                    <p className="text-xs text-muted">
                      {user.email} · {user.sharedDevice ? 'mesmo aparelho' : 'citada em evidência'}
                    </p>
                  </div>
                  <Badge tone={RISK_LEVEL_TONE[user.level]}>
                    {user.score} · {RISK_LEVEL_LABELS[user.level]}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title={`Aparelhos (${data.devices.length})`}>
          {data.devices.length === 0 ? (
            <p className="text-sm text-muted">Nenhum aparelho registrado.</p>
          ) : (
            <ul className="divide-y divide-border text-sm">
              {data.devices.map((device) => (
                <li key={device.id} className="flex items-start gap-3 py-2">
                  <Smartphone className="mt-0.5 h-4 w-4 shrink-0 text-muted" aria-hidden />
                  <div className="min-w-0">
                    <p className="font-mono text-xs text-fg">{device.fingerprint}…</p>
                    <p className="truncate text-xs text-muted" title={device.userAgent ?? undefined}>
                      {device.logins} acesso(s) · primeiro {formatDate(device.firstSeenAt)} · último {formatDateTime(device.lastSeenAt)}
                      {device.lastIp ? ` · IP ${device.lastIp}` : ''}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {data.cases.length > 0 && (
        <Card title="Histórico de casos">
          <ul className="divide-y divide-border text-sm">
            {data.cases.map((item) => (
              <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <Link href={`/antifraude/casos/${item.id}`} className="text-brand-600 hover:underline">
                  Caso #{item.number} · {formatDate(item.createdAt)}
                </Link>
                <span className="flex items-center gap-2">
                  {item.resolution && <span className="max-w-xs truncate text-xs text-muted">{item.resolution}</span>}
                  <Badge tone={RISK_CASE_TONE[item.status]}>{RISK_CASE_STATUS_LABELS[item.status]}</Badge>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {manual && (
        <Dialog open onClose={() => setManual(false)} title="Registrar sinal manual" description="Use para denúncias e verificações da equipe. O sinal soma pontos ao score e pode abrir um caso.">
          <form onSubmit={addSignal} className="space-y-4">
            <Textarea label="O que foi observado" required minLength={5} maxLength={500} value={message} onChange={(event) => setMessage(event.target.value)} />
            <Input label="Pontos (1 a 100)" type="number" min={1} max={100} required value={points} onChange={(event) => setPoints(Number(event.target.value))} />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setManual(false)}>
                Cancelar
              </Button>
              <Button type="submit" loading={busy}>
                Registrar
              </Button>
            </div>
          </form>
        </Dialog>
      )}
      <ConfirmDialog
        open={blocking}
        onClose={() => setBlocking(false)}
        tone="danger"
        title={`Bloquear ${data.user.name}?`}
        description="A conta perde o acesso a todos os apps. A decisão fica registrada na auditoria e pode ser revertida em Usuários."
        confirmLabel="Bloquear conta"
        reason={{ label: 'Motivo', required: true }}
        onConfirm={async (reason) => {
          try {
            await api.post(`admin/users/${data.user.id}/status`, { action: 'BLOCK', reason });
            toast.success('Conta bloqueada.');
            setBlocking(false);
            onChanged();
          } catch (err) {
            toast.error(err);
          }
        }}
      />
    </div>
  );
}
