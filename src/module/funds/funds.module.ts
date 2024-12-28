import { Module } from '@nestjs/common';
import { FundsService } from './funds.service';
import { FundsController } from './funds.controller';
import { PrismaService } from '@/prisma/prisma.service';

@Module({
  controllers: [FundsController],
  providers: [FundsService , PrismaService],
  exports: [FundsService],
})
export class FundsModule {}
