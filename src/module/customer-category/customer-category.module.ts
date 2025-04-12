import { PrismaService } from '@/prisma/prisma.service';
import { Module } from '@nestjs/common';
import { CustomerCategoriesService } from './customer-category.service';
import { CustomerCategoriesController } from './customer-category.controller';

@Module({
  controllers: [CustomerCategoriesController],
  providers: [CustomerCategoriesService , PrismaService],
})
export class CustomerCategoryModule {}