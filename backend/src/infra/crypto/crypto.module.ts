import { Global, Module } from '@nestjs/common';
import { CryptoService } from './crypto.service';
import { PasswordService } from './password.service';

@Global()
@Module({
  providers: [CryptoService, PasswordService],
  exports: [CryptoService, PasswordService],
})
export class CryptoModule {}
