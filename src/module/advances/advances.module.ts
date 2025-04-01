// src/modules/advances/advances.module.ts
import { Module } from '@nestjs/common';
import { AdvancesController } from './advances.controller';
import { AdvancesService } from './advances.service';
import { PrismaService } from '../../prisma/prisma.service';

@Module({
  controllers: [AdvancesController],
  providers: [AdvancesService, PrismaService],
  exports: [AdvancesService]
})
export class AdvancesModule {}