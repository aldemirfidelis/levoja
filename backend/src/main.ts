import 'reflect-metadata';
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { AppConfig } from './config/config.module';
import { configureApp } from './bootstrap';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });
  configureApp(app);
  const config = app.get(AppConfig);
  await app.listen(config.env.PORT, '0.0.0.0');
  console.log(`API ${config.env.APP_NAME} em ${config.env.API_PUBLIC_URL} (docs: ${config.env.API_PUBLIC_URL}/docs)`);
}

void bootstrap();
