import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { RequestContext } from '../request-context';

interface ErrorBody {
  statusCode: number;
  error: string;
  message: string;
  details?: unknown;
  requestId?: string;
}

const PRISMA_ERRORS: Record<string, { status: number; message: string }> = {
  P2002: { status: HttpStatus.CONFLICT, message: 'Registro duplicado.' },
  P2025: { status: HttpStatus.NOT_FOUND, message: 'Registro não encontrado.' },
  P2003: { status: HttpStatus.CONFLICT, message: 'Operação viola um relacionamento existente.' },
  P2034: { status: HttpStatus.CONFLICT, message: 'Conflito de concorrência. Tente novamente.' },
};

/**
 * Formato único de erro da API:
 * { statusCode, error, message, details?, requestId }
 * Erros inesperados nunca expõem detalhes internos ao cliente (apenas ao log).
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('HTTP');

  catch(exception: unknown, host: ArgumentsHost): void {
    if (host.getType() !== 'http') throw exception;
    const response = host.switchToHttp().getResponse<Response>();
    const request = host.switchToHttp().getRequest<Request>();
    const requestId = RequestContext.get()?.requestId;
    const body = this.toBody(exception);
    body.requestId = requestId;

    if (body.statusCode >= 500) {
      this.logger.error(
        { err: exception, requestId, path: request.url, method: request.method },
        exception instanceof Error ? exception.message : 'Erro inesperado',
      );
    }
    if (!response.headersSent) response.status(body.statusCode).json(body);
  }

  private toBody(exception: unknown): ErrorBody {
    if (exception instanceof ThrottlerException) {
      return { statusCode: 429, error: 'Too Many Requests', message: 'Muitas requisições. Aguarde alguns instantes e tente novamente.' };
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const payload = exception.getResponse();
      if (typeof payload === 'string') return { statusCode: status, error: HttpStatus[status] ?? 'Error', message: payload };
      const data = payload as { message?: string | string[]; error?: string; details?: unknown };
      const messages = Array.isArray(data.message) ? data.message : undefined;
      return {
        statusCode: status,
        error: data.error ?? HttpStatus[status] ?? 'Error',
        message: messages ? 'Dados inválidos.' : ((data.message as string | undefined) ?? exception.message),
        details: messages ?? data.details,
      };
    }
    const code = (exception as { code?: string })?.code;
    if (typeof code === 'string' && PRISMA_ERRORS[code]) {
      const mapped = PRISMA_ERRORS[code];
      return { statusCode: mapped.status, error: HttpStatus[mapped.status], message: mapped.message };
    }
    if ((exception as { type?: string })?.type === 'entity.too.large') {
      return { statusCode: 413, error: 'Payload Too Large', message: 'Requisição muito grande.' };
    }
    const multerCode = (exception as { name?: string; code?: string })?.name === 'MulterError' ? code : undefined;
    if (multerCode === 'LIMIT_FILE_SIZE') {
      return { statusCode: 413, error: 'Payload Too Large', message: 'Arquivo excede o tamanho máximo permitido.' };
    }
    return { statusCode: 500, error: 'Internal Server Error', message: 'Erro interno. Tente novamente em instantes.' };
  }
}
