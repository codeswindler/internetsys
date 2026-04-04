import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors();
  (app.getHttpAdapter() as any).getInstance().set('trust proxy', true);
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
// Trigger reload 2
