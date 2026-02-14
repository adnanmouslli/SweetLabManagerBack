import { Controller, Get, Post, Body, Patch, Param, UseGuards, Req, Query } from '@nestjs/common';
import { FundsService } from './funds.service';
import { CreateFundDto } from './dto/create-fund.dto';
import { JwtAuthGuard, Role, Roles, RolesGuard, AuditLog } from '@/common';

@Controller('funds')
@UseGuards(JwtAuthGuard, RolesGuard)
export class FundsController {
  constructor(private readonly fundsService: FundsService) {}

  @Post()
  @AuditLog({ entity: 'Fund', action: 'CREATE' })
  create(@Body() createFundDto: CreateFundDto) {
    return this.fundsService.create(createFundDto);
  }

  @Get()
  findAll() {
    return this.fundsService.findAll();
  }

  @Patch(':id/balance')
  @AuditLog({ entity: 'Fund', action: 'UPDATE_BALANCE' })
  updateBalance(
    @Param('id') id: string,
    @Body('amount') amount: number
  ) {
    return this.fundsService.updateBalance(+id, amount);
  }

  @Post('transfer-to-main')
  @AuditLog({ entity: 'Fund', action: 'TRANSFER_TO_MAIN' })
  async transferToMain(
    @Body('amount') amount: number,
    @Req() req
  ) {
    return this.fundsService.transferToMain(amount, req.user.id);
  }
  

  @Post('transfer-for-next-shift')
  @AuditLog({ entity: 'Fund', action: 'CREATE_PENDING_TRANSFER' })
  createPendingTransfer(
    @Body() transferDto,
    @Req() req
  ) {

    return this.fundsService.createPendingTransferForNextShift(
      transferDto.amount, 
      req.user.id, 
      transferDto.notes
    );
  }

  @Get('pending-transfers')
  checkPendingTransfers() {
    return this.fundsService.checkPendingTransfersForNextShift();
  }

  @Post('handle-pending-transfer/:id')
  @AuditLog({ entity: 'Fund', action: 'HANDLE_PENDING_TRANSFER' })
  handlePendingTransfer(
    @Param('id') id: string,
    @Body() handleDto,
    @Req() req
  ): any {
    return this.fundsService.handlePendingTransfer(
      +id, 
      handleDto.accept, 
      req.user.id, 
      handleDto.shiftId, 
      handleDto.notes
    );
  }

  @Get('transfer-history')
  getPendingTransferHistory(@Query() filterDto: any) {
    return this.fundsService.getPendingTransferHistory(filterDto.status);
  }

}