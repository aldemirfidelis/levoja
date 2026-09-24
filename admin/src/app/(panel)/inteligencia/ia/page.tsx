'use client';

import Link from 'next/link';
import { Bot, CheckCircle2, CircleSlash } from 'lucide-react';
import { AI_FEATURE_LABELS, type AiFeature } from '@levoja/shared';
import { useApi } from '@levoja/web-kit/client';
import { Badge, Card, DataTable, DescriptionList, ErrorState, PageHeader, Skeleton } from '@levoja/web-kit/ui';
import { IntelligenceNav } from '@/components/intelligence-nav';

interface AiStatus {
  provider: 'none' | 'anthropic';
  model: string | null;
  available: boolean;
  features: { supportDrafts: boolean; companyAssistant: boolean; reviewAnalysis: boolean; dailyLimitPerUser: number };
  usage: { feature: AiFeature; status: string; calls: number; inputTokens: number; outputTokens: number; avgLatencyMs: number }[];
}

const STATUS: Record<string, string> = { OK: 'Concluída', REFUSED: 'Recusada pelo modelo', ERROR: 'Falha' };

function Toggle({ on, label }: { on: boolean; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {on ? <CheckCircle2 className="h-4 w-4 text-success" aria-hidden /> : <CircleSlash className="h-4 w-4 text-muted" aria-hidden />}
      {label}: {on ? 'ligado' : 'desligado'}
    </span>
  );
}

export default function AiStatusPage() {
  const { data, error, isLoading, refetch } = useApi<AiStatus>('admin/intelligence/ai');
  return (
    <>
      <PageHeader
        title="Inteligência"
        description="IA assistiva: rascunhos de resposta no atendimento, análise de avaliações e assistente das lojas. A IA sugere; decisões e envios são sempre de uma pessoa."
      />
      <IntelligenceNav />
      {isLoading && <Skeleton className="h-64" />}
      {error && <ErrorState error={error} onRetry={() => refetch()} />}
      {data && (
        <div className="grid gap-6 xl:grid-cols-3">
          <Card title="Provedor">
            <DescriptionList
              items={[
                {
                  label: 'Situação',
                  value: data.available ? <Badge tone="success">Ativa</Badge> : <Badge>Desligada (modo sem IA)</Badge>,
                },
                { label: 'Provedor', value: data.provider === 'anthropic' ? 'Anthropic (Claude)' : 'Nenhum' },
                { label: 'Modelo', value: data.model ?? '—' },
              ]}
            />
            <p className="mt-3 text-xs text-muted">
              Provedor e chave ficam nas variáveis de ambiente do servidor (AI_PROVIDER, ANTHROPIC_API_KEY, AI_MODEL). Sem IA, os recursos usam modelos de texto, léxico e indicadores calculados.
            </p>
          </Card>
          <Card title="Recursos" actions={<Link href="/configuracoes" className="text-sm text-brand-600 hover:underline">Alterar em Configurações (ai)</Link>}>
            <div className="flex flex-col gap-2 text-sm text-fg">
              <Toggle on={data.features.supportDrafts} label="Rascunhos no atendimento" />
              <Toggle on={data.features.reviewAnalysis} label="Análise de avaliações" />
              <Toggle on={data.features.companyAssistant} label="Assistente das lojas" />
              <p className="text-muted">Limite: {data.features.dailyLimitPerUser} uso(s) por pessoa a cada 24 h.</p>
            </div>
          </Card>
          <Card title="Supervisão">
            <p className="text-sm text-fg">
              Toda chamada fica registrada (recurso, modelo, tokens, tempo e resultado). Dados pessoais como telefone, CPF, e-mail e cartão são removidos antes do envio ao modelo.
            </p>
          </Card>
          <div className="xl:col-span-3">
            <Card title="Uso nos últimos 30 dias">
              {data.usage.length === 0 ? (
                <p className="flex items-center gap-2 text-sm text-muted">
                  <Bot className="h-4 w-4" aria-hidden /> Nenhuma chamada registrada.
                </p>
              ) : (
                <DataTable
                  rows={data.usage}
                  rowKey={(row) => `${row.feature}-${row.status}`}
                  columns={[
                    { key: 'feature', header: 'Recurso', cell: (row) => AI_FEATURE_LABELS[row.feature] ?? row.feature },
                    { key: 'status', header: 'Resultado', cell: (row) => STATUS[row.status] ?? row.status },
                    { key: 'calls', header: 'Chamadas', className: 'text-right tabular-nums', cell: (row) => row.calls.toLocaleString('pt-BR') },
                    { key: 'tokens', header: 'Tokens (entrada / saída)', className: 'text-right tabular-nums', cell: (row) => `${row.inputTokens.toLocaleString('pt-BR')} / ${row.outputTokens.toLocaleString('pt-BR')}`, hideOnMobile: true },
                    { key: 'latency', header: 'Tempo médio', className: 'text-right tabular-nums', cell: (row) => `${(row.avgLatencyMs / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} s`, hideOnMobile: true },
                  ]}
                />
              )}
            </Card>
          </div>
        </div>
      )}
    </>
  );
}
