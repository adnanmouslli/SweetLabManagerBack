import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  UseGuards,
  ParseIntPipe,
  Request
} from '@nestjs/common';
import { CustomersService } from './customers.service';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';
import { SupplierPaymentDto } from './dto/supplier-payment.dto';
import { JwtAuthGuard, Role, Roles, RolesGuard, AuditLog } from '@/common';

@Controller('customers')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CustomersController {
  constructor(private readonly customersService: CustomersService) {}

  @Post()
  @AuditLog({ entity: 'Customer', action: 'CREATE' })
  create(@Body() createCustomerDto: CreateCustomerDto) {
    return this.customersService.create(createCustomerDto);
  }

  @Get()
  findAll() {
    return this.customersService.findAll();
  }

  @Get('search')
  search(@Query('q') query: string) {
    return this.customersService.search(query);
  }

  @Get('list')
  getCustomersList() {
    return this.customersService.getCustomersList();
  }

  @Get('customers/list')
  getOnlyCustomersList() {
    return this.customersService.getOnlyCustomersList();
  }

  @Get('suppliers/list')
  getSuppliersList() {
    return this.customersService.getSuppliersList();
  }

  @Get('customers')
  findCustomers() {
    return this.customersService.findCustomers();
  }

  @Get('suppliers')
  findSuppliers() {
    return this.customersService.findSuppliers();
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.customersService.findOne(id);
  }

  @Get(':id/account-statement')
  @Roles(Role.ADMIN, Role.MANAGER, Role.EMPLOYEE)
  getCustomerAccountStatement(@Param('id', ParseIntPipe) id: number) {
    return this.customersService.getCustomerAccountStatement(id);
  }
    
  @Patch(':id')
  @AuditLog({ entity: 'Customer', action: 'UPDATE' })
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateCustomerDto: UpdateCustomerDto
  ) {
    return this.customersService.update(id, updateCustomerDto);
  }

  @Delete(':id')
  @AuditLog({ entity: 'Customer', action: 'DELETE' })
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.customersService.remove(id);
  }

  // Endpoints جديدة لإدارة رصيد الموردين
  @Get('suppliers/balance-report')
  getSuppliersBalanceReport() {
    return this.customersService.getSuppliersBalanceReport();
  }

  @Get(':id/supplier-balance')
  @Roles(Role.ADMIN, Role.MANAGER, Role.EMPLOYEE)
  getSupplierBalance(@Param('id', ParseIntPipe) id: number) {
    return this.customersService.getSupplierBalance(id);
  }

  @Post(':id/supplier-payment')
  @AuditLog({ entity: 'Customer', action: 'SUPPLIER_PAYMENT' })
  paySupplierBalance(
    @Param('id', ParseIntPipe) id: number,
    @Body() paymentDto: SupplierPaymentDto,
    @Request() req
  ) {
    return this.customersService.paySupplierBalance(id, paymentDto, req.user.id);
  }
}