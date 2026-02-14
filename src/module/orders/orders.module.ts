import { Module } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { OrdersController } from './orders.controller';
import { OrderCategoriesService } from '../order-category/order-category.service';
import { PrismaService } from '@/prisma/prisma.service';
import { InvoicesService } from '../invoices/invoices.service';
import { OrderQueueModule } from '../order-queue/order-queue.module';

@Module({
  imports: [OrderQueueModule],
  controllers: [OrdersController],
  providers: [OrdersService, OrderCategoriesService, PrismaService, InvoicesService],
})
export class OrdersModule {}