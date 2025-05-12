import { Controller, Get, Post, Body, Param, UseGuards, ParseIntPipe, Query } from '@nestjs/common';
import { DebtsService } from './debts.service';
import { JwtAuthGuard, Role, Roles, RolesGuard } from '@/common';
import { ApplyDiscountDto } from './dto/apply-discount.dto';

@Controller('debts')
@UseGuards(JwtAuthGuard, RolesGuard)
export class DebtsController {
  constructor(private readonly debtsService: DebtsService) {}

// في ملف debts.controller.ts
  @Get()
  @Roles(Role.ADMIN, Role.MANAGER)
  findAll(@Query('type') type: string) {
    return this.debtsService.findAll(type);
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

  @Post(':id/discount')
  @Roles(Role.ADMIN, Role.MANAGER)
  applyDiscount(
    @Param('id', ParseIntPipe) id: number,
    @Body() discountDto: ApplyDiscountDto
  ) {
    return this.debtsService.applyDiscount(id, discountDto);
  }
}