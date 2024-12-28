import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { appConfig, databaseConfig } from './config/configuration';
import { validate } from './config/env.validation';
import { PrismaConfig } from './config/prisma.config';
import { UsersModule } from './module/users/users.module';
import { AuthModule } from './module/auth/auth.module';
import { ShiftsModule } from './module/shifts/shifts.module';
import { InvoicesModule } from './module/invoices/invoices.module';
import { FundsModule } from './module/funds/funds.module';
import { DebtsModule } from './module/debts/debts.module';
import { ItemsModule } from './module/items/items.module';
import { ItemGroupsModule } from './module/item-groups/item-groups.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [appConfig, databaseConfig],
      validate,
      expandVariables: true,
    }),
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ([
        {
          ttl: config.get('app.rateLimit.ttl'),
          limit: config.get('app.rateLimit.max'),
        },
      ]),
    }),

    UsersModule,
    AuthModule,
    ShiftsModule,
    InvoicesModule,
    FundsModule,
    DebtsModule,
    ItemsModule,
    ItemGroupsModule
  ],
  providers: [PrismaConfig],
  exports: [PrismaConfig],
})
export class AppModule {}