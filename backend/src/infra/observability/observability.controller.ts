import { Controller, Get, Headers, NotFoundException, Param, Res, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { ApiExcludeEndpoint, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';
import { Public } from '../../common/decorators';
import { AppConfig } from '../../config/config.module';
import { PrismaService } from '../prisma/prisma.service';
import { CacheService } from '../cache/cache.service';
import { StorageService } from '../storage/storage.service';
import { JobsService } from '../jobs/jobs.service';
import { metricsRegistry } from './metrics';
import { extractBearer } from '../../common/guards/jwt-auth.guard';

const startedAt = new Date();

@ApiTags('Observabilidade')
@SkipThrottle()
@Controller()
export class ObservabilityController {
  constructor(
    private readonly config: AppConfig,
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    private readonly storage: StorageService,
    private readonly jobs: JobsService,
  ) {}

  @Public()
  @Get('health')
  @ApiOperation({ summary: 'Liveness: o processo está no ar' })
  health() {
    return { status: 'ok', uptimeSeconds: Math.round(process.uptime()), startedAt };
  }

  @Public()
  @Get('health/ready')
  @ApiOperation({ summary: 'Readiness: dependências (banco, cache, armazenamento)' })
  async ready() {
    const [database, cache, storage] = await Promise.all([this.prisma.ping(), this.cache.ping(), this.storage.ping()]);
    const checks = {
      database: database ? 'up' : 'down',
      cache: `${cache ? 'up' : 'down'} (${this.cache.backend})`,
      storage: storage ? 'up' : 'down',
      jobs: this.jobs.backend,
    };
    if (!database || !cache || !storage) throw new ServiceUnavailableException({ status: 'error', checks });
    return { status: 'ok', checks };
  }

  @Public()
  @Get('metrics')
  @ApiExcludeEndpoint()
  async metrics(@Headers('authorization') authorization: string | undefined, @Res() response: Response) {
    const token = this.config.env.METRICS_TOKEN;
    if (token && extractBearer(authorization) !== token) throw new UnauthorizedException();
    response.setHeader('Content-Type', metricsRegistry.contentType);
    response.send(await metricsRegistry.metrics());
  }
}

/**
 * Serve arquivos PÚBLICOS (logos, fotos) quando não há CDN configurada.
 * Arquivos privados nunca são servidos por aqui.
 */
@ApiTags('Arquivos')
@SkipThrottle()
@Controller('files')
export class PublicFilesController {
  constructor(private readonly storage: StorageService) {}

  @Public()
  @Get('public/*path')
  @ApiExcludeEndpoint()
  async serve(@Param('path') path: string | string[], @Res() response: Response) {
    const key = `public/${Array.isArray(path) ? path.join('/') : path}`;
    let file;
    try {
      file = await this.storage.get(key);
    } catch {
      throw new NotFoundException();
    }
    if (!file) throw new NotFoundException();
    const ext = key.split('.').pop()?.toLowerCase();
    const types: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' };
    response.setHeader('Content-Type', file.contentType ?? types[ext ?? ''] ?? 'application/octet-stream');
    response.setHeader('Cache-Control', 'public, max-age=86400, immutable');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    file.stream.pipe(response);
  }
}
