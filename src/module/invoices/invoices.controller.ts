  import { Controller, Get, Post, Body, Param, UseGuards, Req, Query, Put, Delete } from '@nestjs/common';
  import { CreateInvoiceDto } from './dto/create-invoice.dto';
  import { JwtAuthGuard, RolesGuard } from '@/common';
  import { InvoicesService } from './invoices.service';
import { FilterInvoiceDto } from './dto/filter-invoice.dto';
import { InvoiceCategory, InvoiceType } from '@prisma/client';
import { UpdateInvoiceDto } from './dto/update-invoice.dto';
import { ConfirmTransferDto, TransferHistoryQueryDto, TransferToBoothUniversityDto, TransferToMainRequestDto } from './dto/transfer-request.dto';


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

  @Get('summary')
  getSummary() {
    return this.invoicesService.getSummary();
  }

  @Get('current-shift')
  getCurrentShiftInvoices() {
  return this.invoicesService.getCurrentShiftInvoices();
  }

  @Get('raw-material-expenses')
  getRawMaterialExpenseInvoices(@Query() query: FilterInvoiceDto) {
    return this.invoicesService.getRawMaterialExpenseInvoices(query);
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

  @Post(':id/pay')
  markAsPaid(@Param('id') id: string) {
    return this.invoicesService.markAsPaid(+id);
  }

  @Post(':id/convert-to-debt')
  convertToDebt(@Param('id') id: string) {
    return this.invoicesService.convertInvoiceToDebt(+id);
  }
  
  @Put(':id')
  updateInvoice(@Param('id') id: string, @Body() updateInvoiceDto: UpdateInvoiceDto, @Req() req) {
    return this.invoicesService.updateInvoice(+id, updateInvoiceDto , req.user.id);
  }


  @Delete(':invoiceId')
  async deleteInvoice(@Param('invoiceId') invoiceId: number): Promise<string> {
    return await this.invoicesService.deleteInvoice(+invoiceId);
  }


// قسم التحويلات
@Post('transfer/booth-university-to-general')
transferFromBoothOrUniversityToGeneral(
  @Body() transferData: TransferToBoothUniversityDto,
  @Req() req
) {
  return this.invoicesService.transferFromBoothOrUniversityToGeneral(
    transferData.sourceId,
    transferData.amount,
    req.user.id,
    transferData.notes
  );
}

@Post('transfer/to-main/request')
createTransferToMainRequest(
  @Body() requestData: TransferToMainRequestDto,
  @Req() req
) : Promise<any>{
  return this.invoicesService.createTransferToMainRequest(
    requestData.amount,
    req.user.id,
    requestData.notes
  );
}

@Post('transfer/to-main/confirm/:requestId')
confirmTransferToMain(
  @Param('requestId') requestId: string,
  @Body() confirmData: ConfirmTransferDto,
  @Req() req
) : Promise<any> {
  return this.invoicesService.confirmTransferToMain(
    +requestId,
    req.user.id,
    confirmData.confirm,
    confirmData.rejectionReason
  );
}

@Get('transfer/to-main/pending')
getPendingTransferRequests() {
  return this.invoicesService.getPendingTransferRequests();
}

@Get('transfer/to-main/history')
getTransferRequestHistory(
  @Query('status') status?: string,
  @Query('startDate') startDate?: string,
  @Query('endDate') endDate?: string,
  @Query('requestedById') requestedById?: string
) {
  const queryDto: TransferHistoryQueryDto = {
    status,
    startDate: startDate ? new Date(startDate) : undefined,
    endDate: endDate ? new Date(endDate) : undefined,
    requestedById: requestedById ? +requestedById : undefined,
  };
  
  return this.invoicesService.getTransferRequestHistory(queryDto);
}


}