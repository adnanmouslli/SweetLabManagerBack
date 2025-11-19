import { Module } from '@nestjs/common';
import { BackupService } from './backup.service';
import { BackupController } from './backup.controller';
import { ScheduleModule } from '@nestjs/schedule';

@Module({
  imports:[ScheduleModule.forRoot()],
  providers: [BackupService],
  controllers: [BackupController]
})
export class BackupModule {}
