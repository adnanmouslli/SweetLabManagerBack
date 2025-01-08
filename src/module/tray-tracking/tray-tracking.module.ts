import { Module } from '@nestjs/common';
import { TrayTrackingService } from './tray-tracking.service';
import { TrayTrackingController } from './tray-tracking.controller';
import { PrismaService } from '@/prisma/prisma.service';

@Module({

  exports:[TrayTrackingService],
  
  controllers: [TrayTrackingController],
  providers: [TrayTrackingService , PrismaService],
})
export class TrayTrackingModule {}
