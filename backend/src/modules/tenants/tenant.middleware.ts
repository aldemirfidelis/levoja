import { ForbiddenException, Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { TenantsService } from './tenants.service';
import { RequestContext } from '../../common/request-context';

declare module 'express' {
  interface Request {
    tenant?: { id: string; slug: string };
  }
}

@Injectable()
export class TenantMiddleware implements NestMiddleware {
  constructor(private readonly tenants: TenantsService) {}

  async use(request: Request, _response: Response, next: NextFunction): Promise<void> {
    try {
      const header = request.headers['x-tenant'];
      const tenant = await this.tenants.resolve(typeof header === 'string' ? header : undefined, request.headers.host);
      if (tenant.status !== 'ACTIVE') throw new ForbiddenException('Plataforma temporariamente indisponível.');
      request.tenant = { id: tenant.id, slug: tenant.slug };
      RequestContext.set({ tenantId: tenant.id });
      next();
    } catch (error) {
      next(error);
    }
  }
}
