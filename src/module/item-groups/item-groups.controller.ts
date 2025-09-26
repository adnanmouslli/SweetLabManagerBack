import { 
  Controller, 
  Get, 
  Post, 
  Body, 
  Patch, 
  Param, 
  Delete, 
  UseGuards,
  Query, 
  UseInterceptors,
  UploadedFile,
  BadRequestException
} from '@nestjs/common';
import { ItemGroupsService } from './item-groups.service';
import { CreateItemGroupDto } from './dto/create-item-group.dto';
import { UpdateItemGroupDto } from './dto/update-item-group.dto';
import { JwtAuthGuard, Role, Roles, RolesGuard } from '@/common';
import { ItemType } from '@prisma/client';
import { FileInterceptor } from '@nestjs/platform-express';


@Controller('item-groups')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ItemGroupsController {
  constructor(private readonly itemGroupsService: ItemGroupsService) {}

  @Post()
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


  @Post('import-excel')
@UseInterceptors(FileInterceptor('file'))
async importItemsFromExcel(@UploadedFile() file: any) {
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

  return await this.itemGroupsService.importItemsFromExcel(file.buffer);
}
}