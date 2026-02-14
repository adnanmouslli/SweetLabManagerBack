import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  ParseIntPipe,
  UploadedFile,
  UseInterceptors,
  BadRequestException
} from '@nestjs/common';
import { CreateCustomerCategoryDto } from './dto/create-customer-category.dto';
import { UpdateCustomerCategoryDto } from './dto/update-customer-category.dto';
import { JwtAuthGuard, Role, Roles, RolesGuard, AuditLog } from '@/common';
import { CustomerCategoriesService } from './customer-category.service';
import { FileInterceptor } from '@nestjs/platform-express';

@Controller('customer-categories')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CustomerCategoriesController {
  constructor(private readonly customerCategoriesService: CustomerCategoriesService) {}

  @Post()
  @Roles(Role.ADMIN, Role.MANAGER)
  @AuditLog({ entity: 'CustomerCategory', action: 'CREATE' })
  create(@Body() createCustomerCategoryDto: CreateCustomerCategoryDto) {
    return this.customerCategoriesService.create(createCustomerCategoryDto);
  }

  @Get()
  @Roles(Role.ADMIN, Role.MANAGER, Role.EMPLOYEE)
  findAll() {
    return this.customerCategoriesService.findAll();
  }

  @Get('list')
  @Roles(Role.ADMIN, Role.MANAGER, Role.EMPLOYEE)
  getCategoriesList() {
    return this.customerCategoriesService.getCategoriesList();
  }

  @Get(':id')
  @Roles(Role.ADMIN, Role.MANAGER, Role.EMPLOYEE)
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.customerCategoriesService.findOne(id);
  }

  @Patch(':id')
  @Roles(Role.ADMIN, Role.MANAGER)
  @AuditLog({ entity: 'CustomerCategory', action: 'UPDATE' })
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateCustomerCategoryDto: UpdateCustomerCategoryDto
  ) {
    return this.customerCategoriesService.update(id, updateCustomerCategoryDto);
  }

  @Delete(':id')
  @Roles(Role.ADMIN)
  @AuditLog({ entity: 'CustomerCategory', action: 'DELETE' })
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.customerCategoriesService.remove(id);
  }

  @Post('import-excel')
@AuditLog({ entity: 'CustomerCategory', action: 'IMPORT_CUSTOMERS_EXCEL', captureBody: false })
@UseInterceptors(FileInterceptor('file'))
async importCustomersFromExcel(@UploadedFile() file: any) {
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

  return await this.customerCategoriesService.importCustomersFromExcel(file.buffer);
}

@Post('import-suppliers-excel')
@AuditLog({ entity: 'CustomerCategory', action: 'IMPORT_SUPPLIERS_EXCEL', captureBody: false })
@UseInterceptors(FileInterceptor('file'))
async importSuppliersFromExcel(@UploadedFile() file: any) {
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

  return await this.customerCategoriesService.importSuppliersFromExcel(file.buffer);
}

}