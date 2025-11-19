import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { exec } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as SFTPClient from 'ssh2-sftp-client';
const SSH2Promise = require('ssh2-promise');

@Injectable()
export class BackupService {
  private readonly logger = new Logger(BackupService.name);

  private LOCAL_DB = process.env.LOCAL_DB;
  private LOCAL_USER = process.env.LOCAL_USER;
  private LOCAL_PASS = process.env.LOCAL_PASS;

  private VPS_IP = process.env.VPS_IP;
  private VPS_USER = process.env.VPS_USER;
  private VPS_PASSWORD = process.env.VPS_PASSWORD;
  private VPS_DB = process.env.VPS_DB;
  private VPS_DB_USER = process.env.VPS_DB_USER;
  private VPS_DB_PASS = process.env.VPS_DB_PASS;
  private VPS_REMOTE_DIR = process.env.VPS_REMOTE_DIR;

  private LOCAL_BACKUP_DIR = process.env.LOCAL_BACKUP_DIR;


  @Cron(CronExpression.EVERY_5_MINUTES)
  async performBackup() {
    this.logger.log('Running scheduled DB backup...');

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const dumpName = `${this.LOCAL_DB}-${timestamp}.dump`;
    const dumpPath = path.join(this.LOCAL_BACKUP_DIR, dumpName);

    try {
      // 0) إنشاء مجلد النسخ الاحتياطية إن لم يكن موجوداً
      if (!fs.existsSync(this.LOCAL_BACKUP_DIR)) {
        fs.mkdirSync(this.LOCAL_BACKUP_DIR, { recursive: true });
      }

      // 1) إنشاء dump محلي
      this.logger.log('Creating pg_dump...');
      process.env.PGPASSWORD = this.LOCAL_PASS;

      await this.execCommand(
        `"C:\\Program Files\\PostgreSQL\\16\\bin\\pg_dump.exe" -Fc -U ${this.LOCAL_USER} -d ${this.LOCAL_DB} -f "${dumpPath}"`
      );
      this.logger.log(`Dump created successfully: ${dumpPath}`);

      // 2) رفع dump إلى VPS عبر SFTP
      this.logger.log('Uploading dump to VPS...');
      const sftp = new SFTPClient();
      await sftp.connect({
        host: this.VPS_IP,
        username: this.VPS_USER,
        password: this.VPS_PASSWORD,
      });

      const remotePath = `${this.VPS_REMOTE_DIR}/${dumpName}`;
      await sftp.fastPut(dumpPath, remotePath);
      await sftp.end();
      this.logger.log('Dump uploaded successfully.');

      // 3) استعادة dump على VPS مباشرة
      this.logger.log('Executing restore on VPS...');
      const ssh = new SSH2Promise({
        host: this.VPS_IP,
        username: this.VPS_USER,
        password: this.VPS_PASSWORD,
      });

      await ssh.connect();
      await ssh.exec(
        `PGPASSWORD="${this.VPS_DB_PASS}" pg_restore -h 127.0.0.1 -U ${this.VPS_DB_USER} -d ${this.VPS_DB} --clean --if-exists --no-owner "${remotePath}"`
      );

      // حذف النسخة من VPS بعد الاستعادة
      await ssh.exec(`rm -f "${remotePath}"`);
      await ssh.close();
      this.logger.log('VPS restoration complete.');

    //   const ssh = new SSH2Promise({
    // host: this.VPS_IP,
    // username: this.VPS_USER,
    // password: this.VPS_PASSWORD,
    // } as any);

    // await ssh.connect();
    // await ssh.exec(`bash /root/restore_dump.sh ${dumpName}`);
    // await ssh.close();


      // 4) تنظيف النسخ القديمة (>7 أيام)
      this.cleanupOldBackups();
      this.logger.log('Backup job finished successfully.');
    } catch (error) {
      this.logger.error(
        'Backup failed:',
        error instanceof Error ? error.stack : JSON.stringify(error),
      );
    }
  }

  // تشغيل أوامر shell في Windows
  private execCommand(cmd: string): Promise<void> {
    return new Promise((resolve, reject) => {
      exec(cmd, (error, stdout, stderr) => {
        if (error) reject(stderr || error.message);
        else resolve();
      });
    });
  }

  // تنظيف نسخ قديمة (>7 أيام)
  private cleanupOldBackups() {
    if (!fs.existsSync(this.LOCAL_BACKUP_DIR)) return;

    fs.readdirSync(this.LOCAL_BACKUP_DIR).forEach((file) => {
      const fullPath = path.join(this.LOCAL_BACKUP_DIR, file);
      const stats = fs.statSync(fullPath);

      const ageDays =
        (Date.now() - stats.mtime.getTime()) / (1000 * 60 * 60 * 24);

      if (ageDays > 7) {
        fs.unlinkSync(fullPath);
        this.logger.log(`Deleted old backup: ${file}`);
      }
    });
  }
}
