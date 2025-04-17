import { Module } from '@nestjs/common';
import { OrderCategoriesService } from './order-category.service';
import { OrderCategoriesController } from './order-category.controller';
import { PrismaService } from '@/prisma/prisma.service';

@Module({
  controllers: [OrderCategoriesController],
  providers: [OrderCategoriesService , PrismaService],
})
export class OrderCategoryModule {}
