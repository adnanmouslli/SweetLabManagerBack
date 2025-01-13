import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';


async function bootstrap() {

  const app = await NestFactory.create(AppModule);
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

  const corsOrigin = configService.get('CORS_ORIGIN', 'http://localhost:3000');
  app.enableCors({
    origin: corsOrigin,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
    maxAge: 3600,
  });


  // const host = configService.get('HOST', '0.0.0.0');
  const port = configService.get('PORT', 80);
  
  await app.listen(80);
  

  const serverUrl = await app.getUrl();
  console.log(`Environment: ${configService.get('NODE_ENV', 'development')}`);
  console.log(`Server is running on: ${serverUrl}`);
  console.log(`CORS enabled for: ${corsOrigin}`);
  console.log(`API prefix: ${apiPrefix}`);
  console.log('--------------------------------------------------------');  
}

bootstrap().catch((error) => {
  new Logger('Bootstrap').error('Failed to start application', error);
  process.exit(1); 
});