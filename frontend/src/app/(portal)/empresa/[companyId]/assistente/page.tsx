'use client';

import { FormEvent, useState } from 'react';
import { AlertTriangle, Bot, CheckCircle2, Info, Send, Sparkles } from 'lucide-react';
import { formatBRL, REVIEW_THEME_LABELS, type ReviewTheme } from '@levoja/shared';
import { api, useApi } from '@levoja/web-kit/client';
import { BarList, Button, Card, ComparisonChart, PageHeader, Skeleton, StatCard, Textarea } from '@levoja/web-kit/ui';
import { useCompany } from '@/lib/company';
import { PlanAwareError } from '@/components/plan-gate';

interface Insights {
  company: { tradeName: string; ratingAvg: number; ratingCount: number; declaredPrepMinutes: number; learnedPrepMinutes: number | null };
  sales: { orders: number; revenue: number; canceled: number; canceledByStore: number; averageTicketCents: number; previousOrders: number; previousRevenue: number };
  performance: { delivered: number; lateRate: number | null; medianAcceptMinutes: number | null; medianPrepMinutes: number | null; medianTotalMinutes: number | null };
  topProducts: { name: string; quantity: number; revenue: number; orders: number }[];
  peakHours: { weekday: number; hour: number; averagePerWeek: number }[];
  reviews: { total: number; positive: number; negative: number; themes: { theme: ReviewTheme; total: number; negative: number }[] };
  forecast: { series: { date: string; weekday: string; predicted: number; low: number; high: number; basedOnWeeks: number }[]; accuracy: { wape: number | null } };
  recommendations: { id: string; tone: 'info' | 'warning' | 'success'; title: string; detail: string }[];
  assistant: { available: boolean };
}

interface Message {
  role: 'user' | 'assistant';
  content: string;
  sources?: string[];
}

const WEEKDAYS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
const SUGGESTIONS = ['Quais são meus horários de pico?', 'Quais produtos vendem mais neste mês?', 'Como foram minhas vendas nos últimos 7 dias?', 'O que os clientes reclamam nas avaliações?'];
const TOOL_LABELS: Record<string, string> = {
  resumo_vendas: 'vendas',
  produtos_mais_vendidos: 'produtos',
  demanda_por_horario: 'horários',
  desempenho_entregas: 'entregas',
  avaliacoes: 'avaliações',
  previsao_pedidos: 'previsão',
};
const minutes = (value: number | null) => (value == null ? '—' : `${Math.round(value)} min`);
const change = (current: number, previous: number) => (previous ? `${current >= previous ? '+' : ''}${Math.round(((current - previous) / previous) * 100)}% vs. 30 dias anteriores` : 'Sem período anterior');

function Recommendation({ item }: { item: Insights['recommendations'][number] }) {
  const Icon = item.tone === 'warning' ? AlertTriangle : item.tone === 'success' ? CheckCircle2 : Info;
  const color = item.tone === 'warning' ? 'text-warning' : item.tone === 'success' ? 'text-success' : 'text-brand-600';
  return (
    <li className="flex gap-3 rounded-lg border border-border p-3 text-sm">
      <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${color}`} aria-hidden />
      <div>
        <p className="font-medium text-fg">{item.title}</p>
        <p className="mt-0.5 text-muted">{item.detail}</p>
      </div>
    </li>
  );
}

function Chat({ companyId }: { companyId: string }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const ask = async (question: string) => {
    const content = question.trim();
    if (!content || busy) return;
    const history = [...messages, { role: 'user' as const, content }];
    setMessages(history);
    setText('');
    setBusy(true);
    setNotice(null);
    try {
      const result = await api.post<{ available: boolean; answer: string | null; sources?: string[]; notice: string }>(`companies/${companyId}/assistant/ask`, {
        messages: history.map(({ role, content: body }) => ({ role, content: body })),
      });
      if (result.answer) setMessages([...history, { role: 'assistant', content: result.answer, sources: result.sources }]);
      setNotice(result.notice);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Não foi possível consultar o assistente.');
    } finally {
      setBusy(false);
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void ask(text);
  };

  return (
    <div className="flex flex-col gap-3">
      {messages.length === 0 && (
        <div className="flex flex-wrap gap-2">
          {SUGGESTIONS.map((suggestion) => (
            <button key={suggestion} type="button" onClick={() => void ask(suggestion)} className="rounded-full border border-border px-3 py-1.5 text-xs text-fg hover:bg-surface-2">
              {suggestion}
            </button>
          ))}
        </div>
      )}
      <ol className="max-h-[28rem] space-y-3 overflow-y-auto" aria-live="polite">
        {messages.map((message, index) => (
          <li key={index} className={`rounded-lg p-3 text-sm ${message.role === 'user' ? 'ml-8 bg-brand-500/10 text-fg' : 'mr-8 border border-border text-fg'}`}>
            <p className="whitespace-pre-wrap">{message.content}</p>
            {message.sources && message.sources.length > 0 && (
              <p className="mt-2 text-xs text-muted">Consultou: {message.sources.map((source) => TOOL_LABELS[source] ?? source).join(', ')}</p>
            )}
          </li>
        ))}
        {busy && (
          <li className="mr-8 flex items-center gap-2 rounded-lg border border-border p-3 text-sm text-muted">
            <Bot className="h-4 w-4 animate-pulse" aria-hidden /> Analisando os dados da loja…
          </li>
        )}
      </ol>
      {notice && <p className="text-xs text-muted">{notice}</p>}
      <form onSubmit={submit} className="flex items-end gap-2">
        <Textarea
          className="flex-1"
          label="Pergunte sobre vendas, horários, produtos ou avaliações"
          rows={2}
          maxLength={1000}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              void ask(text);
            }
          }}
        />
        <Button type="submit" icon={<Send className="h-4 w-4" />} loading={busy} disabled={!text.trim()} aria-label="Enviar pergunta" />
      </form>
    </div>
  );
}

export default function CompanyAssistantPage() {
  const { company } = useCompany();
  const { data, error, isLoading, refetch } = useApi<Insights>(`companies/${company.id}/assistant`);

  if (error) return <PlanAwareError error={error} onRetry={() => refetch()} />;
  if (isLoading || !data) return <Skeleton className="h-96" />;
  const { sales, performance } = data;
  const onTime = performance.lateRate == null ? null : 1 - performance.lateRate;

  return (
    <>
      <PageHeader title="Assistente" description="Indicadores da loja, previsão de pedidos e recomendações. As sugestões são apoio: a decisão é sempre da sua equipe." />
      {data.recommendations.length > 0 && (
        <Card title="Recomendações" className="mb-6">
          <ul className="grid gap-3 lg:grid-cols-2">
            {data.recommendations.map((item) => (
              <Recommendation key={item.id} item={item} />
            ))}
          </ul>
        </Card>
      )}
      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Pedidos (30 dias)" value={sales.orders.toLocaleString('pt-BR')} hint={change(sales.orders, sales.previousOrders)} />
        <StatCard label="Faturamento em produtos" value={formatBRL(sales.revenue)} hint={`Ticket médio ${formatBRL(sales.averageTicketCents)}`} />
        <StatCard label="Entregas no prazo" value={onTime == null ? '—' : `${Math.round(onTime * 100)}%`} hint={`${performance.delivered} entregues · total mediano ${minutes(performance.medianTotalMinutes)}`} />
        <StatCard
          label="Preparo real (mediana)"
          value={minutes(performance.medianPrepMinutes)}
          hint={`Informado: ${data.company.declaredPrepMinutes} min · aceite em ${minutes(performance.medianAcceptMinutes)}`}
          tone={performance.medianPrepMinutes != null && performance.medianPrepMinutes > data.company.declaredPrepMinutes + 5 ? 'warning' : 'neutral'}
        />
      </div>
      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <Card title="Previsão de pedidos (próximos 7 dias)">
            {data.forecast.series.every((day) => day.basedOnWeeks === 0) ? (
              <p className="text-sm text-muted">A previsão começa depois da primeira semana de pedidos.</p>
            ) : (
              <>
                <ComparisonChart
                  title="Pedidos previstos por dia nos próximos 7 dias, com intervalo de 80%"
                  points={data.forecast.series.map((day) => ({
                    label: day.weekday.slice(0, 3),
                    tooltip: `${day.weekday}, ${day.date.split('-').reverse().slice(0, 2).join('/')}`,
                    value: day.predicted,
                    low: day.low,
                    high: day.high,
                  }))}
                  format={(value) => value.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}
                  valueLabel="Pedidos previstos"
                  intervalLabel="Intervalo (80%)"
                  height={220}
                />
                {data.forecast.accuracy.wape != null && (
                  <p className="mt-2 text-xs text-muted">Nos últimos 14 dias, o método errou em média {Math.round(data.forecast.accuracy.wape * 100)}% do volume real.</p>
                )}
              </>
            )}
          </Card>
          <Card
            title={
              <span className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-brand-600" aria-hidden /> Pergunte ao assistente
              </span>
            }
          >
            {data.assistant.available ? (
              <Chat companyId={company.id} />
            ) : (
              <p className="text-sm text-muted">O assistente com IA não está habilitado nesta plataforma. Os indicadores e recomendações desta página continuam atualizados.</p>
            )}
          </Card>
        </div>
        <div className="space-y-6">
          <Card title="Horários de pico (últimas 8 semanas)">
            {data.peakHours.length === 0 ? (
              <p className="text-sm text-muted">Sem pedidos suficientes.</p>
            ) : (
              <BarList
                title="Horários com mais pedidos"
                format={(value) => `${value.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}/sem.`}
                rows={data.peakHours.map((slot) => ({ label: `${WEEKDAYS[slot.weekday]}, ${slot.hour}h`, value: slot.averagePerWeek }))}
              />
            )}
          </Card>
          <Card title="Mais vendidos (30 dias)">
            {data.topProducts.length === 0 ? (
              <p className="text-sm text-muted">Sem vendas no período.</p>
            ) : (
              <BarList
                title="Produtos mais vendidos"
                format={(value) => `${value.toLocaleString('pt-BR')} un.`}
                rows={data.topProducts.map((product) => ({ label: product.name, value: product.quantity, hint: formatBRL(product.revenue) }))}
              />
            )}
          </Card>
          <Card title="O que dizem as avaliações (90 dias)">
            {data.reviews.total === 0 ? (
              <p className="text-sm text-muted">Nenhuma avaliação no período.</p>
            ) : (
              <>
                <p className="mb-3 text-sm text-fg">
                  {data.reviews.positive} positiva(s) e {data.reviews.negative} negativa(s) de {data.reviews.total}.
                </p>
                {data.reviews.themes.some((theme) => theme.negative > 0) ? (
                  <BarList
                    title="Temas nas avaliações negativas"
                    format={(value) => value.toLocaleString('pt-BR')}
                    rows={data.reviews.themes
                      .filter((theme) => theme.negative > 0)
                      .sort((a, b) => b.negative - a.negative)
                      .slice(0, 6)
                      .map((theme) => ({ label: REVIEW_THEME_LABELS[theme.theme] ?? theme.theme, value: theme.negative }))}
                  />
                ) : (
                  <p className="text-sm text-muted">Nenhum tema recorrente nas avaliações negativas.</p>
                )}
              </>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
