  import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards, Req, Query } from '@nestjs/common';
  import { OrdersService } from './orders.service';
  import { CreateOrderDto } from './dto/create-order.dto';
  import { UpdateOrderDto } from './dto/update-order.dto';
  import { FilterOrdersDto } from './dto/filter-orders.dto';
  import { JwtAuthGuard, RolesGuard, Role, Roles } from '@/common';
  import { OrderStatus } from '@prisma/client';
import { CreateInvoiceDto } from '../invoices/dto/create-invoice.dto';

  @Controller('orders')
  @UseGuards(JwtAuthGuard, RolesGuard)
  export class OrdersController {
    constructor(private readonly ordersService: OrdersService) {}

    @Post()
    create(@Body() createOrderDto: CreateOrderDto, @Req() req) {
      return this.ordersService.create(createOrderDto, req.user.id);
    }

    @Get('last-for-customer/:customerId')
    getLastOrderForCustomer(@Param('customerId') customerId: string) {
      return this.ordersService.getLastOrderForCustomer(+customerId);
    }

    @Get()
    findAll(@Query() filterDto: FilterOrdersDto) {
      return this.ordersService.findAll(filterDto);
    }

    @Get('summary')
    getSummary() {
      return this.ordersService.getOrdersSummary();
    }

    @Get('for-preparation')
    getOrdersForPreparation() {
      return this.ordersService.getOrdersForPreparation();
    }

    @Get('for-delivery-today')
    getOrdersForDeliveryToday() {
      return this.ordersService.getOrdersForDeliveryToday();
    }

    @Get(':id')
    findOne(@Param('id') id: string) {
      return this.ordersService.findOne(+id);
    }

    @Patch(':id')
    update(@Param('id') id: string, @Body() updateOrderDto: UpdateOrderDto, @Req() req) {
      return this.ordersService.update(+id, updateOrderDto, req.user.id);
    }

    @Delete(':id')
    @Roles(Role.MANAGER, Role.ADMIN)
    remove(@Param('id') id: string) {
      return this.ordersService.remove(+id);
    }

    @Post(':id/convert-to-invoice')
    convertToInvoice(
      @Param('id') id: string, 
      @Body() invoiceData: Partial<CreateInvoiceDto>,
      @Req() req
    ) {
      return this.ordersService.convertToInvoice(+id, req.user.id, invoiceData);
    }

    @Patch(':id/status/:status')
    updateStatus(@Param('id') id: string, @Param('status') status: OrderStatus) {
      return this.ordersService.updateOrderStatus(+id, status);
    }
  }