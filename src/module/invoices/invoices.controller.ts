  import { Controller, Get, Post, Body, Param, UseGuards, Req, Query } from '@nestjs/common';
  import { CreateInvoiceDto } from './dto/create-invoice.dto';
  import { JwtAuthGuard, RolesGuard } from '@/common';
  import { InvoicesService } from './invoices.service';
import { FilterInvoiceDto } from './dto/filter-invoice.dto';
import { InvoiceCategory, InvoiceType } from '@prisma/client';


@Controller('invoices')
@UseGuards(JwtAuthGuard, RolesGuard)
export class InvoicesController {
  constructor(private readonly invoicesService: InvoicesService) {}

  @Post()
  create(@Body() createInvoiceDto: CreateInvoiceDto, @Req() req) {
    return this.invoicesService.create(createInvoiceDto, req.user.id);
  }

  @Get()
  findAll(@Query() query: FilterInvoiceDto) {
    return this.invoicesService.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.invoicesService.findOne(+id);
  }

  @Get('type/:type/category/:category')
  findByTypeAndCategory(
    @Param('type') type: InvoiceType,
    @Param('category') category: InvoiceCategory
  ) {
    return this.invoicesService.findByTypeAndCategory(type, category);
  }

  @Get('summary')
  getSummary() {
    return this.invoicesService.getSummary();
  }

  @Post(':id/pay')
  markAsPaid(@Param('id') id: string) {
    return this.invoicesService.markAsPaid(+id);
  }
}