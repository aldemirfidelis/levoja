import { Global, Module } from '@nestjs/common';
import { CacheService } from './cache/cache.service';
import { JobsService } from './jobs/jobs.service';
import { StorageService } from './storage/storage.service';
import { MailService } from './mail/mail.service';

/** Serviços de infraestrutura compartilhados (cache, filas, arquivos, e-mail). */
@Global()
@Module({
  providers: [CacheService, JobsService, StorageService, MailService],
  exports: [CacheService, JobsService, StorageService, MailService],
})
export class InfraModule {}
