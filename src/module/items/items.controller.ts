import { Controller, Get, Post, Body, Param, UseGuards } from '@nestjs/common';
import { ItemsService } from './items.service';
import { CreateItemDto } from './dto/create-item.dto';
import { JwtAuthGuard, Role, Roles, RolesGuard } from '@/common';

@Controller('items')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ItemsController {
  constructor(private readonly itemsService: ItemsService) {}

  @Post()
  @Roles(Role.MANAGER, Role.ADMIN)
  create(@Body() createItemDto: CreateItemDto) {
    return this.itemsService.create(createItemDto);
  }

  @Get()
  findAll() {
    return this.itemsService.findAll();
  }

  @Get('group/:id')
  findByGroup(@Param('id') id: string) {
    return this.itemsService.findByGroup(+id);
  }
}