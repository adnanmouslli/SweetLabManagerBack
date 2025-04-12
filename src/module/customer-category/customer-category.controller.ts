import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  ParseIntPipe
} from '@nestjs/common';
import { CreateCustomerCategoryDto } from './dto/create-customer-category.dto';
import { UpdateCustomerCategoryDto } from './dto/update-customer-category.dto';
import { JwtAuthGuard, Role, Roles, RolesGuard } from '@/common';
import { CustomerCategoriesService } from './customer-category.service';

@Controller('customer-categories')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CustomerCategoriesController {
  constructor(private readonly customerCategoriesService: CustomerCategoriesService) {}

  @Post()
  @Roles(Role.ADMIN, Role.MANAGER)
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
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateCustomerCategoryDto: UpdateCustomerCategoryDto
  ) {
    return this.customerCategoriesService.update(id, updateCustomerCategoryDto);
  }

  @Delete(':id')
  @Roles(Role.ADMIN)
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.customerCategoriesService.remove(id);
  }
}