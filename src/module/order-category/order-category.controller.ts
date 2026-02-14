import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards, Query } from '@nestjs/common';
import { CreateOrderCategoryDto } from './dto/create-order-category.dto';
import { UpdateOrderCategoryDto } from './dto/update-order-category.dto';
import { JwtAuthGuard, RolesGuard, Role, Roles, AuditLog } from '@/common';
import { OrderCategoriesService } from './order-category.service';

@Controller('order-categories')
@UseGuards(JwtAuthGuard, RolesGuard)
export class OrderCategoriesController {
  constructor(private readonly orderCategoriesService: OrderCategoriesService) {}

  @Post()
  @AuditLog({ entity: 'OrderCategory', action: 'CREATE' })
  create(@Body() createOrderCategoryDto: CreateOrderCategoryDto) {
    console.log("test in contoller");

    return this.orderCategoriesService.create(createOrderCategoryDto);
  }
  @Get('with-customers')
  getCategoriesWithCustomers(
    @Query('forToday') forToday?: string,
    @Query('forTomorrow') forTomorrow?: string
  ) {
  
    const forTodayBool = forToday === 'true';
    const forTomorrowBool = forTomorrow === 'true';
    
    return this.orderCategoriesService.getCategoriesWithCustomersAndOrders(forTodayBool, forTomorrowBool);
  }
  

  @Get()
  findAll() {
    return this.orderCategoriesService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.orderCategoriesService.findOne(+id);
  }

  @Patch(':id')
  @AuditLog({ entity: 'OrderCategory', action: 'UPDATE' })
  update(@Param('id') id: string, @Body() updateOrderCategoryDto: UpdateOrderCategoryDto) {
    return this.orderCategoriesService.update(+id, updateOrderCategoryDto);
  }

  @Delete(':id')
  @AuditLog({ entity: 'OrderCategory', action: 'DELETE' })
  remove(@Param('id') id: string) {
    return this.orderCategoriesService.remove(+id);
  }

 
}