  import { Controller, Get, Post, Body, Param, UseGuards, Req, Query, Put, Delete, BadRequestException, NotFoundException } from '@nestjs/common';
  import { CreateInvoiceDto } from './dto/create-invoice.dto';
  import { JwtAuthGuard, RolesGuard } from '@/common';
  import { InvoicesService } from './invoices.service';
import { FilterInvoiceDto } from './dto/filter-invoice.dto';
import { InvoiceCategory, InvoiceType } from '@prisma/client';
import { UpdateInvoiceDto } from './dto/update-invoice.dto';
import { ConfirmTransferDto, TransferHistoryQueryDto, TransferToBoothUniversityDto, TransferToMainRequestDto } from './dto/transfer-request.dto';
import { ConvertToBreakDto } from './dto/convert-to-break.dto';
import { InventoryQueryDto } from './dto/Inventory/inventory-query.dto';
import { InventoryAuditDto } from './dto/Inventory/inventory-audit.dto';
import { BuyUSDDto, SellUSDDto } from './dto/currency-exchange.dto';


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

@Post('transfer/from/:sourceId/to-main/request')
createTransferToMainRequest(
  @Param('sourceId') sourceId: string,
  @Body() requestData: TransferToMainRequestDto,
  @Req() req
): Promise<any> {
  return this.invoicesService.createTransferToMainRequest(
    +sourceId, 
    requestData.amount,
    req.user.id,
    requestData.notes,
    requestData.currency || 'SYP'
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

@Post(':id/convert-to-break')
convertToBreak(@Param('id') id: string, @Body() convertToBreakDto: ConvertToBreakDto) {
  return this.invoicesService.convertToBreak(+id, convertToBreakDto);
}



// 1. جلب المواد الموجودة في المخزون (فقط التي لها كمية > 0)
@Get('inventory/items')
async getInventoryItems() {
  try {
    const items = await this.invoicesService.getInventoryItems();
    return {
      success: true,
      data: items,
      count: items.length,
      message: 'تم جلب المواد الموجودة في المخزون بنجاح'
    };
  } catch (error) {
    throw new BadRequestException('حدث خطأ أثناء جلب المواد من المخزون');
  }
}

// 2. إجراء الجرد
@Post('inventory/audit')
async performInventoryAudit(
  @Body() auditDto: InventoryAuditDto,
  @Req() req: any
) {
  try {
    const employeeId = req.user?.id;
    
    if (!auditDto.items || auditDto.items.length === 0) {
      throw new BadRequestException('يجب تحديد مواد للجرد');
    }

    const result = await this.invoicesService.performInventoryAudit(
      auditDto.items,
      employeeId
    );

    return {
      success: true,
      data: result,
      message: 'تم إجراء الجرد بنجاح'
    };
  } catch (error) {
    if (error instanceof BadRequestException) {
      throw error;
    }
    throw new BadRequestException('حدث خطأ أثناء إجراء الجرد');
  }
}

// 3. جلب تاريخ الجرد
@Get('inventory/audit-history')
async getInventoryAuditHistory(@Query() query: InventoryQueryDto) {
  try {
    const history = await this.invoicesService.getInventoryAuditHistory(query.limit);
    return {
      success: true,
      data: history,
      count: history.length,
      message: 'تم جلب تاريخ الجرد بنجاح'
    };
  } catch (error) {
    throw new BadRequestException('حدث خطأ أثناء جلب تاريخ الجرد');
  }
}

// 4. جلب تفاصيل جرد محدد
@Get('inventory/audit/:id')
async getInventoryAuditDetails(@Param('id') id: string) {
  try {
    const auditId = parseInt(id);
    if (isNaN(auditId)) {
      throw new BadRequestException('معرف الجرد غير صالح');
    }

    const audit = await this.invoicesService.getInventoryAuditDetails(auditId);
    return {
      success: true,
      data: audit,
      message: 'تم جلب تفاصيل الجرد بنجاح'
    };
  } catch (error) {
    if (error instanceof BadRequestException || error instanceof NotFoundException) {
      throw error;
    }
    throw new BadRequestException('حدث خطأ أثناء جلب تفاصيل الجرد');
  }
}

// 5. جلب حركات المخزون لمادة محددة
@Get('inventory/movements/:itemId')
async getItemStockMovements(
  @Param('itemId') itemId: string,
  @Query() query: InventoryQueryDto
) {
  try {
    const id = parseInt(itemId);
    if (isNaN(id)) {
      throw new BadRequestException('معرف المادة غير صالح');
    }

    const movements = await this.invoicesService.getItemStockMovements(id, query.limit);
    return {
      success: true,
      data: movements,
      count: movements.length,
      message: 'تم جلب حركات المخزون بنجاح'
    };
  } catch (error) {
    if (error instanceof BadRequestException) {
      throw error;
    }
    throw new BadRequestException('حدث خطأ أثناء جلب حركات المخزون');
  }
}

// 6. جلب تقرير المخزون الشامل
@Get('inventory/report')
async getInventoryReport() {
  try {
    const report = await this.invoicesService.getInventoryReport();
    return {
      success: true,
      data: report,
      message: 'تم جلب تقرير المخزون بنجاح'
    };
  } catch (error) {
    throw new BadRequestException('حدث خطأ أثناء جلب تقرير المخزون');
  }
}


// مسار بيع الدولار
@Post('currency/sell-usd')
async sellUSD(
  @Body() sellUSDDto: SellUSDDto,
  @Req() req: any
) {
  try {
    const result = await this.invoicesService.sellUSD(
      sellUSDDto.usdAmount,
      sellUSDDto.syrAmount,
      sellUSDDto.targetFundId,
      req.user.id,
      sellUSDDto.notes
    );

    return {
      success: true,
      data: result,
      message: 'تم بيع الدولار بنجاح'
    };
  } catch (error) {
    if (error instanceof BadRequestException) {
      throw error;
    }
    throw new BadRequestException('حدث خطأ أثناء عملية بيع الدولار');
  }
}

// مسار شراء الدولار
@Post('currency/buy-usd')
async buyUSD(
  @Body() buyUSDDto: BuyUSDDto,
  @Req() req: any
) {
  try {
    const result = await this.invoicesService.buyUSD(
      buyUSDDto.usdAmount,
      buyUSDDto.syrAmount,
      buyUSDDto.sourceFundId,
      req.user.id,
      buyUSDDto.notes
    );

    return {
      success: true,
      data: result,
      message: 'تم شراء الدولار بنجاح'
    };
  } catch (error) {
    if (error instanceof BadRequestException) {
      throw error;
    }
    throw new BadRequestException('حدث خطأ أثناء عملية شراء الدولار');
  }
}

}