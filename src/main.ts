import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';


async function bootstrap() {

  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn', 'debug', 'log', 'verbose'],
  });
  const logger = new Logger('Bootstrap');
  const configService = app.get(ConfigService);

  const apiPrefix = configService.get('API_PREFIX', '/');
  app.setGlobalPrefix(apiPrefix);
  
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    transformOptions: {
      enableImplicitConversion: true,
    },
  }));

  const corsOrigin = configService.get('CORS_ORIGIN', '*');
  app.enableCors();

  const port = process.env.PORT || 3000;
  
  await app.listen(port);
  

  const serverUrl = await app.getUrl();
  console.log(`Server is running on: ${serverUrl}`);
  console.log(`Environment: ${configService.get('NODE_ENV', 'development')}`);
  console.log(`API prefix: ${apiPrefix}`);
}

bootstrap().catch((error) => {
  new Logger('Bootstrap').error('Failed to start application', error);
  process.exit(1); 
});