import { Controller, Get, Logger } from '@nestjs/common';
import { BackupService } from './backup.service';

@Controller('backup')
export class BackupController {
  private readonly logger = new Logger(BackupController.name);

  constructor(private readonly backupService: BackupService) {}

  /**
   * Endpoint لتشغيل النسخة الاحتياطية يدويًا
   * GET /backup/run
   */
  @Get('run')
  async runBackup() {
    this.logger.log('Manual backup triggered.');

    try {
      await this.backupService.performBackup();
      this.logger.log('Manual backup completed successfully.');
      return { status: 'success', message: 'Backup executed manually' };
    } catch (error) {
      this.logger.error(
        'Manual backup failed:',
        error instanceof Error ? error.stack : JSON.stringify(error),
      );
      return {
        status: 'error',
        message: 'Backup failed',
        error: error instanceof Error ? error.message : JSON.stringify(error),
      };
    }
  }
}
