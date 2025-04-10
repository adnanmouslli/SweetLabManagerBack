import { Controller, Get, Post, Put, Delete, Body, Param, UseGuards, Query, BadRequestException } from '@nestjs/common';
import { ShiftsService } from './shifts.service';
import { CreateShiftDto } from './dto/create-shift.dto';
import { UpdateShiftDto } from './dto/update-shift.dto';
import { JwtAuthGuard, Role, Roles, RolesGuard, User } from '@/common';
import { ShiftStatus, ShiftType } from '@prisma/client';
import { CloseShiftDto } from './dto/close-shift.dto';

@Controller('shifts')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ShiftsController {
  constructor(private readonly shiftsService: ShiftsService) {}

  @Post()
  create(@Body() createShiftDto: CreateShiftDto, @User() user) {
    return this.shiftsService.create(createShiftDto, user);
  }
  
  @Get()
  findAll() {
    return this.shiftsService.findAll();
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() updateShiftDto: UpdateShiftDto) {
    return this.shiftsService.update(+id, updateShiftDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.shiftsService.remove(+id);
  }

  @Post('close')
  closeShift(@Body() closeShiftDto: CloseShiftDto) {
    return this.shiftsService.closeShift(closeShiftDto.actualAmount);
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
  async getCurrentShiftSummary() {
    return this.shiftsService.getCurrentShiftSummary();
  }
  @Get(':id/summary')
  async getShiftSummary(@Param('id') id: string) {
    return this.shiftsService.getShiftSummary(+id);
  }


  @Get(':shiftId/invoices-by-fund')
  async getInvoicesByFund(@Param('shiftId') shiftId: number) {
    return await this.shiftsService.getShiftInvoicesByFund(+shiftId);
  }

  @Get('check-pending-transfers')
  async checkPendingTransfers() {
  return this.shiftsService.checkForPendingTransfers();
  }

}