import { Controller, Get, Post, Put, Delete, Body, Param, UseGuards, Query, BadRequestException, ParseIntPipe } from '@nestjs/common';
import { ShiftsService } from './shifts.service';
import { CreateShiftDto } from './dto/create-shift.dto';
import { UpdateShiftDto } from './dto/update-shift.dto';
import { JwtAuthGuard, Role, Roles, RolesGuard, User, AuditLog } from '@/common';
import { ShiftStatus, ShiftType } from '@prisma/client';
import { CloseShiftDto } from './dto/close-shift.dto';
import { CompleteShiftClosureDto } from './dto/complete-shift-closure.dto';

@Controller('shifts')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ShiftsController {
  constructor(private readonly shiftsService: ShiftsService) {}

  @Post()
  @AuditLog({ entity: 'Shift', action: 'CREATE' })
  create(@Body() createShiftDto: CreateShiftDto, @User() user) {
    return this.shiftsService.create(createShiftDto, user);
  }
  
  @Get()
  findAll(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
    @Query('shiftType') shiftType?: ShiftType,
    @Query('status') status?: ShiftStatus,
  ) {
    return this.shiftsService.findAll({ page, limit, search, shiftType, status });
  }


  @Get('partial-close')
  @AuditLog({ entity: 'Shift', action: 'PARTIAL_CLOSE' })
  async partialCloseShift() {
    return this.shiftsService.partialCloseShift();
  }



  @Put(':id')
  @AuditLog({ entity: 'Shift', action: 'UPDATE' })
  update(@Param('id') id: string, @Body() updateShiftDto: UpdateShiftDto) {
    return this.shiftsService.update(+id, updateShiftDto);
  }

  @Delete(':id')
  @AuditLog({ entity: 'Shift', action: 'DELETE' })
  remove(@Param('id') id: string) {
    return this.shiftsService.remove(+id);
  }

  @Post('close')
  @AuditLog({ entity: 'Shift', action: 'CLOSE' })
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

  @Get('active')
  async getActiveShift() {
    return this.shiftsService.getActiveShift();
  }

 
  

  @Post(':id/complete-closure')
  @AuditLog({ entity: 'Shift', action: 'COMPLETE_CLOSURE' })
  async completeShiftClosure(
    @Param('id', ParseIntPipe) id: number,
    @Body() completeShiftClosureDto: CompleteShiftClosureDto
  ) {
    return this.shiftsService.completeShiftClosure(id, completeShiftClosureDto.actualAmount);
  }


}