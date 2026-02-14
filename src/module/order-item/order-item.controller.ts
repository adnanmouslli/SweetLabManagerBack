import { Controller, Get, Post, Body, Patch, Param, Delete } from '@nestjs/common';
import { OrderItemService } from './order-item.service';
import { CreateOrderItemDto } from './dto/create-order-item.dto';
import { UpdateOrderItemDto } from './dto/update-order-item.dto';
import { AuditLog } from '@/common';

@Controller('order-item')
export class OrderItemController {
  constructor(private readonly orderItemService: OrderItemService) {}

  @Post()
  @AuditLog({ entity: 'OrderItem', action: 'CREATE' })
  create(@Body() createOrderItemDto: CreateOrderItemDto) {
    return this.orderItemService.create(createOrderItemDto);
  }

  @Get()
  findAll() {
    return this.orderItemService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.orderItemService.findOne(+id);
  }

  @Patch(':id')
  @AuditLog({ entity: 'OrderItem', action: 'UPDATE' })
  update(@Param('id') id: string, @Body() updateOrderItemDto: UpdateOrderItemDto) {
    return this.orderItemService.update(+id, updateOrderItemDto);
  }

  @Delete(':id')
  @AuditLog({ entity: 'OrderItem', action: 'DELETE' })
  remove(@Param('id') id: string) {
    return this.orderItemService.remove(+id);
  }
}
