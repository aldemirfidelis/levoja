import { Global, Module } from '@nestjs/common';
import { ChatService } from './chat.service';
import { VoiceProvider } from './voice.provider';
import { AdminConversationsController, CompanyConversationsController, ConversationsController } from './chat.controller';

/** Fase 6 — Chat entre cliente, loja e entregador e ligação mascarada. */
@Global()
@Module({
  providers: [ChatService, VoiceProvider],
  controllers: [ConversationsController, CompanyConversationsController, AdminConversationsController],
  exports: [ChatService],
})
export class ChatModule {}
