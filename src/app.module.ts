import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
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
import { TrayTrackingModule } from './module/tray-tracking/tray-tracking.module';
import { CustomersModule } from './module/customers/customers.module';
import { AdvancesModule } from './module/advances/advances.module';
import { CustomerCategoryModule } from './module/customer-category/customer-category.module';
import { OrdersModule } from './module/orders/orders.module';
import { OrderCategoryModule } from './module/order-category/order-category.module';
import { OrderItemModule } from './module/order-item/order-item.module';
import { EmployeesModule } from './module/employees/employees.module';
import { WorkshopsModule } from './module/workshops/workshops.module';
import { PdfReportsModule } from './module/pdf-reports/pdf-reports.module';
import { BackupModule } from './module/backup/backup.module';
import { OrderQueueModule } from './module/order-queue/order-queue.module';
import { ScheduleModule } from '@nestjs/schedule';
import { AuditLogModule } from './module/audit-log/audit-log.module';
import { AuditInterceptor } from './common/interceptors/audit.interceptor';
import { PrismaService } from './prisma/prisma.service';

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
    ItemGroupsModule,
    TrayTrackingModule,
    CustomersModule,
    AdvancesModule,
    CustomerCategoryModule,
    OrdersModule,
    OrderCategoryModule,
    OrderItemModule,
    EmployeesModule,
    WorkshopsModule,
    PdfReportsModule,
    OrderQueueModule,
    ScheduleModule.forRoot(),
    AuditLogModule,
    // BackupModule
  ],
  providers: [
    PrismaConfig,
    PrismaService,
    {
      provide: APP_INTERCEPTOR,
      useClass: AuditInterceptor,
    },
  ],
  exports: [PrismaConfig],
})
export class AppModule {}