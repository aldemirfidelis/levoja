import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Counter, Histogram, Registry, collectDefaultMetrics } from 'prom-client';
import { Observable, tap } from 'rxjs';

/** Registro Prometheus da aplicação (exposto em GET /metrics). */
export const metricsRegistry = new Registry();
metricsRegistry.setDefaultLabels({ app: 'levoja-api' });
collectDefaultMetrics({ register: metricsRegistry });

export const httpDuration = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duração das requisições HTTP',
  labelNames: ['method', 'route', 'status'],
  buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [metricsRegistry],
});

export const httpErrors = new Counter({
  name: 'http_request_errors_total',
  help: 'Requisições com status >= 500',
  labelNames: ['method', 'route'],
  registers: [metricsRegistry],
});

/** Métricas de negócio: incrementadas pelos módulos (pedidos, entregas, pagamentos...). */
export const businessEvents = new Counter({
  name: 'business_events_total',
  help: 'Eventos de negócio',
  labelNames: ['event'],
  registers: [metricsRegistry],
});

@Injectable()
export class MetricsInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const request = context.switchToHttp().getRequest();
    const response = context.switchToHttp().getResponse();
    const end = httpDuration.startTimer();
    // Usa o padrão da rota (ex.: /v1/companies/:companyId) para não explodir a cardinalidade.
    const route = request.route?.path ?? 'unmatched';
    const record = () => {
      const status = String(response.statusCode);
      end({ method: request.method, route, status });
      if (response.statusCode >= 500) httpErrors.inc({ method: request.method, route });
    };
    return next.handle().pipe(tap({ next: record, error: () => record() }));
  }
}
