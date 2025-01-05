import { Controller, Get, Post, Put, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { ShiftsService } from './shifts.service';
import { CreateShiftDto } from './dto/create-shift.dto';
import { UpdateShiftDto } from './dto/update-shift.dto';
import { JwtAuthGuard, Role, Roles, RolesGuard, User } from '@/common';

@Controller('shifts')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ShiftsController {
  constructor(private readonly shiftsService: ShiftsService) {}

  @Post()
  @Roles(Role.EMPLOYEE, Role.MANAGER)
  create(@Body() createShiftDto: CreateShiftDto, @User() user) {
    return this.shiftsService.create(createShiftDto, user);
  }
  
  @Get()
  findAll() {
    return this.shiftsService.findAll();
  }

  @Put(':id')
  @Roles(Role.MANAGER)
  update(@Param('id') id: string, @Body() updateShiftDto: UpdateShiftDto) {
    return this.shiftsService.update(+id, updateShiftDto);
  }

  @Delete(':id')
  @Roles(Role.MANAGER)
  remove(@Param('id') id: string) {
    return this.shiftsService.remove(+id);
  }

  @Post(':id/close')
  @Roles(Role.EMPLOYEE, Role.MANAGER)
  closeShift(@Param('id') id: string) {
    return this.shiftsService.closeShift(+id);
  }
}