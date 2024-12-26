import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaConfig extends PrismaClient {
  constructor(config: ConfigService) {
    const url = config.get('database.url');
    const ssl = config.get('database.ssl');

    super({
      datasources: {
        db: {
          url,
        },
      },
      log: config.get('app.env') === 'development' 
        ? ['query', 'info', 'warn', 'error']
        : ['error'],
    });
  }
}