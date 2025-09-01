import { Module } from '@nestjs/common';
import { ReportsController } from './pdf-reports.controller';
import { PDFReportsService } from './pdf-reports.service';
import { PrismaService } from '@/prisma/prisma.service';


@Module({
  controllers: [ReportsController],
  providers: [PDFReportsService , PrismaService],
})
export class PdfReportsModule {}
