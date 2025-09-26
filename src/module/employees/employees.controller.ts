import { Controller, Get, Post, Body, Param, Delete, Put, Query, ParseIntPipe, UseGuards, Req, BadRequestException, UploadedFile, UseInterceptors } from '@nestjs/common';
import { EmployeesService } from './employees.service';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';
import { CreateEmployeeWithdrawalDto } from './dto/create-employee-withdrawal.dto';
import { CreateEmployeePaymentDto } from './dto/create-employee-payment.dto';
import { CreateEmployeeProductionDto } from './dto/employee-production.dto';
import { CreateEmployeeHoursDto } from './dto/employee-hours.dto';
import { JwtAuthGuard, RolesGuard } from '@/common';
import { FileInterceptor } from '@nestjs/platform-express';


@Controller('employees')
@UseGuards(JwtAuthGuard, RolesGuard)
export class EmployeesController {
  constructor(private readonly employeesService: EmployeesService) {}

  @Post()
  create(@Body() createEmployeeDto: CreateEmployeeDto) {
    return this.employeesService.create(createEmployeeDto);
  }

  @Get()
  findAll() {
    return this.employeesService.findAll();
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.employeesService.findOne(id);
  }

  @Put(':id')
  update(
    @Param('id', ParseIntPipe) id: number, 
    @Body() updateEmployeeDto: UpdateEmployeeDto
  ) {
    return this.employeesService.update(id, updateEmployeeDto);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.employeesService.remove(id);
  }

  @Post(':id/withdrawals')
  addWithdrawal(
    @Param('id', ParseIntPipe) id: number,
    @Body() withdrawalDto: CreateEmployeeWithdrawalDto,
    @Req() req
  ) {
    const currentUserId = req.user.id;
    return this.employeesService.addWithdrawal(id, withdrawalDto, currentUserId);
  }

  @Post(':id/payments')
  addPayment(
    @Param('id', ParseIntPipe) id: number,
    @Body() paymentDto: CreateEmployeePaymentDto,
    @Req() req
  ) {
    const currentUserId = req.user.id;
    return this.employeesService.addPayment(id, paymentDto, currentUserId);
  }

  @Post(':id/production')
  addProduction(
    @Param('id', ParseIntPipe) id: number,
    @Body() productionDto: CreateEmployeeProductionDto
  ) {
    return this.employeesService.addProduction(id, productionDto);
  }

  @Post(':id/hours')
  addHours(
    @Param('id', ParseIntPipe) id: number,
    @Body() hoursDto: CreateEmployeeHoursDto
  ) {
    return this.employeesService.addHours(id, hoursDto);
  }

  @Get(':id/financial-summary')
  getFinancialSummary(
    @Param('id', ParseIntPipe) id: number,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string
  ) {
    const start = startDate ? new Date(startDate) : undefined;
    const end = endDate ? new Date(endDate) : undefined;
    return this.employeesService.getFinancialSummary(id, start, end);
  }


  @Post('import-excel')
@UseInterceptors(FileInterceptor('file'))
async importEmployeesFromExcel(@UploadedFile() file: any) {
  if (!file) {
    throw new BadRequestException('لم يتم اختيار ملف');
  }

  // التحقق من نوع الملف
  const allowedTypes = [
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
    'application/vnd.ms-excel', // .xls
  ];

  if (!allowedTypes.includes(file.mimetype)) {
    throw new BadRequestException('يجب أن يكون الملف من نوع Excel (.xlsx أو .xls)');
  }

  return await this.employeesService.importEmployeesFromExcel(file.buffer);
}
}