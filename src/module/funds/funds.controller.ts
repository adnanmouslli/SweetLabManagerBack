import { Controller, Get, Post, Body, Patch, Param, UseGuards, Req, Query } from '@nestjs/common';
import { FundsService } from './funds.service';
import { CreateFundDto } from './dto/create-fund.dto';
import { JwtAuthGuard, Role, Roles, RolesGuard } from '@/common';

@Controller('funds')
@UseGuards(JwtAuthGuard, RolesGuard)
export class FundsController {
  constructor(private readonly fundsService: FundsService) {}

  @Post()
  @Roles(Role.ADMIN)
  create(@Body() createFundDto: CreateFundDto) {
    return this.fundsService.create(createFundDto);
  }

  @Get()
  @Roles(Role.MANAGER, Role.ADMIN)
  findAll() {
    return this.fundsService.findAll();
  }

  @Patch(':id/balance')
  @Roles(Role.MANAGER, Role.ADMIN)
  updateBalance(
    @Param('id') id: string,
    @Body('amount') amount: number
  ) {
    return this.fundsService.updateBalance(+id, amount);
  }

  @Post('transfer-to-main')
  @Roles(Role.MANAGER, Role.ADMIN) // Only managers and admins can transfer
  async transferToMain(
    @Body('amount') amount: number,
    @Req() req
  ) {
    return this.fundsService.transferToMain(amount, req.user.id);
  }
  

  @Post('transfer-for-next-shift')
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