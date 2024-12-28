import { Controller, Get, Post, Body, Param, UseGuards } from '@nestjs/common';
import { ShiftsService } from './shifts.service';
import { CreateShiftDto } from './dto/create-shift.dto';

import { JwtAuthGuard, Role, Roles, RolesGuard } from '@/common';

@Controller('shifts')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ShiftsController {
  constructor(private readonly shiftsService: ShiftsService) {}

  @Post()
  @Roles(Role.EMPLOYEE, Role.MANAGER)
  create(@Body() createShiftDto: CreateShiftDto) {
    return this.shiftsService.create(createShiftDto);
  }

  @Get()
  findAll() {
    return this.shiftsService.findAll();
  }

  @Post(':id/close')
  @Roles(Role.EMPLOYEE, Role.MANAGER)
  closeShift(@Param('id') id: string) {
    return this.shiftsService.closeShift(+id);
  }
}