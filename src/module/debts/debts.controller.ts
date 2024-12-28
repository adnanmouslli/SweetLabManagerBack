import { Controller, Get, Post, Body, Param, UseGuards } from '@nestjs/common';
import { DebtsService } from './debts.service';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { JwtAuthGuard, Role, Roles, RolesGuard } from '@/common';


@Controller('debts')
@UseGuards(JwtAuthGuard, RolesGuard)
export class DebtsController {
  constructor(private readonly debtsService: DebtsService) {}

  @Get()
  @Roles(Role.MANAGER, Role.ADMIN)
  findAll() {
    return this.debtsService.findAll();
  }

  @Post(':id/payments')
  @Roles(Role.MANAGER, Role.ADMIN)
  addPayment(
    @Param('id') id: string,
    @Body() createPaymentDto: CreatePaymentDto
  ) {
    return this.debtsService.addPayment(+id, createPaymentDto);
  }

  @Get('customer/:phone')
  @Roles(Role.MANAGER, Role.ADMIN, Role.EMPLOYEE)
  getCustomerDebts(@Param('phone') phone: string) {
    return this.debtsService.getCustomerDebts(phone);
  }
}