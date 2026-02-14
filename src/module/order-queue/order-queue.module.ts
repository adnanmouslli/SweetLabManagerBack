import { Module } from '@nestjs/common';
import { OrderQueueService } from './order-queue.service';
import { OrderQueueController } from './order-queue.controller';
import { PrismaService } from '@/prisma/prisma.service';

@Module({
  controllers: [OrderQueueController],
  providers: [OrderQueueService, PrismaService],
  exports: [OrderQueueService],
})
export class OrderQueueModule {}
