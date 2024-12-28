import { Controller, Get, Post, Body, Param, UseGuards, Req } from '@nestjs/common';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { JwtAuthGuard, RolesGuard } from '@/common';
import { InvoicesService } from './invoices.service';


@Controller('invoices')
@UseGuards(JwtAuthGuard, RolesGuard)
export class InvoicesController {
  constructor(private readonly invoicesService: InvoicesService) {}

  @Post()
  create(@Body() createInvoiceDto: CreateInvoiceDto, @Req() req) {
    return this.invoicesService.create(createInvoiceDto, req.user.id);
  }

  @Get()
  findAll() {
    return this.invoicesService.findAll();
  }

  @Get('unpaid')
  findUnpaid() {
    return this.invoicesService.findUnpaid();
  }

  @Post(':id/pay')
  markAsPaid(@Param('id') id: string) {
    return this.invoicesService.markAsPaid(+id);
  }
}