import { 
  Controller, 
  Get, 
  Post, 
  Body, 
  Patch, 
  Param, 
  Delete, 
  UseGuards,
  Query 
} from '@nestjs/common';
import { ItemGroupsService } from './item-groups.service';
import { CreateItemGroupDto } from './dto/create-item-group.dto';
import { UpdateItemGroupDto } from './dto/update-item-group.dto';
import { JwtAuthGuard, Role, Roles, RolesGuard } from '@/common';
import { ItemType } from '@prisma/client';


@Controller('item-groups')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ItemGroupsController {
  constructor(private readonly itemGroupsService: ItemGroupsService) {}

  @Post()
  @Roles(Role.MANAGER, Role.ADMIN)
  create(@Body() createItemGroupDto: CreateItemGroupDto) {
    return this.itemGroupsService.create(createItemGroupDto);
  }

  @Get()
  findAll() {
    return this.itemGroupsService.findAll();
  }

  @Get('type/:type')
  findByType(@Param('type') type: ItemType) {
    return this.itemGroupsService.findByType(type);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.itemGroupsService.findOne(+id);
  }

  @Patch(':id')
  @Roles(Role.MANAGER, Role.ADMIN)
  update(@Param('id') id: string, @Body() updateItemGroupDto: UpdateItemGroupDto) {
    return this.itemGroupsService.update(+id, updateItemGroupDto);
  }

  @Delete(':id')
  @Roles(Role.MANAGER, Role.ADMIN)
  remove(@Param('id') id: string) {
    return this.itemGroupsService.remove(+id);
  }
}