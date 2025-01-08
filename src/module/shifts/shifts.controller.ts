import { Controller, Get, Post, Put, Delete, Body, Param, UseGuards, Query } from '@nestjs/common';
import { ShiftsService } from './shifts.service';
import { CreateShiftDto } from './dto/create-shift.dto';
import { UpdateShiftDto } from './dto/update-shift.dto';
import { JwtAuthGuard, Role, Roles, RolesGuard, User } from '@/common';
import { ShiftStatus, ShiftType } from '@prisma/client';

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

  @Get('close')
  @Roles(Role.EMPLOYEE, Role.MANAGER)
  closeShift() {
    return this.shiftsService.closeShift();
  }

  @Get('filter')
  findFilteredShifts(
  @Query('status') status?: ShiftStatus,
  @Query('shiftType') shiftType?: ShiftType
  ) {
    console.log(status);
    return this.shiftsService.findShiftsByStatusOrType(status, shiftType);
  }
  
  @Get('current/summary')
  @Roles(Role.EMPLOYEE, Role.MANAGER)
  async getCurrentShiftSummary() {
    return this.shiftsService.getCurrentShiftSummary();
  }
  @Get(':id/summary')
  @Roles(Role.EMPLOYEE, Role.MANAGER)
  async getShiftSummary(@Param('id') id: string) {
    return this.shiftsService.getShiftSummary(+id);
  }


}