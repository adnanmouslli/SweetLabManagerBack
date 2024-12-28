import { Module } from '@nestjs/common';
import { ShiftsService } from './shifts.service';
import { ShiftsController } from './shifts.controller';
import { PrismaService } from '@/prisma/prisma.service';

@Module({
  exports: [ShiftsService],

  controllers: [ShiftsController],
  providers: [ShiftsService , PrismaService],
})
export class ShiftsModule {}
