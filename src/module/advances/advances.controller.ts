// src/modules/advances/advances.controller.ts
import { 
  Controller, 
  Get, 
  Post, 
  Body, 
  Param, 
  UseGuards, 
  ParseIntPipe, 
  Request
} from '@nestjs/common';
import { AdvancesService } from './advances.service';
import { CreateAdvanceDto } from './dto/create-advance.dto';
import { RepayAdvanceDto } from './dto/repay-advance.dto';
import { JwtAuthGuard, Role, Roles, RolesGuard } from '@/common';

@Controller('advances')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AdvancesController {
  constructor(private readonly advancesService: AdvancesService) {}

  @Get()
  @Roles(Role.ADMIN, Role.MANAGER)
  findAll() {
    return this.advancesService.findAll();
  }

  @Get('active')
  getActiveAdvances() {
    return this.advancesService.getActiveAdvances();
  }

  @Get('customer/:customerId')
  getCustomerAdvances(@Param('customerId', ParseIntPipe) customerId: number) {
    return this.advancesService.getCustomerAdvances(customerId);
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.advancesService.findOne(id);
  }

  @Post()
  createAdvance(@Body() createAdvanceDto: CreateAdvanceDto, @Request() req) {
    return this.advancesService.createAdvance(createAdvanceDto, req.user.id);
  }

  @Post(':id/repay')
  repayAdvance(
    @Param('id', ParseIntPipe) id: number,
    @Body() repayAdvanceDto: RepayAdvanceDto,
    @Request() req
  ) {
    return this.advancesService.processRepayment(
      id,
      repayAdvanceDto.amount,
      repayAdvanceDto.fundId,
      req.user.id,
      repayAdvanceDto.notes
    );
  }
}