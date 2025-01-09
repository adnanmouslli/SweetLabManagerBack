import { Controller, Get, Param, UseGuards, ParseIntPipe } from '@nestjs/common';
import { DebtsService } from './debts.service';
import { JwtAuthGuard, Role, Roles, RolesGuard } from '@/common';

@Controller('debts')
@UseGuards(JwtAuthGuard, RolesGuard)
export class DebtsController {
  constructor(private readonly debtsService: DebtsService) {}

  @Get()
  @Roles(Role.ADMIN, Role.MANAGER)
  findAll() {
    return this.debtsService.findAll();
  }

  @Get('active')
  @Roles(Role.ADMIN, Role.MANAGER, Role.EMPLOYEE)
  getActiveDebts() {
    return this.debtsService.getActiveDebts();
  }

  @Get('customer/:customerId')
  @Roles(Role.ADMIN, Role.MANAGER, Role.EMPLOYEE)
  getCustomerDebts(@Param('customerId', ParseIntPipe) customerId: number) {
    return this.debtsService.getCustomerDebts(customerId);
  }

  @Get(':id')
  @Roles(Role.ADMIN, Role.MANAGER, Role.EMPLOYEE)
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.debtsService.findOne(id);
  }
}