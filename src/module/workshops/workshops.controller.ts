import { Controller, Get, Post, Body, Param, Delete, Put, UseGuards, Req, ParseIntPipe, Query } from '@nestjs/common';
import { WorkshopsService } from './workshops.service';
import { CreateWorkshopDto } from './dto/create-workshop.dto';
import { UpdateWorkshopDto } from './dto/update-workshop.dto';
import { CreateWorkshopProductionDto } from './dto/create-workshop-production.dto';
import { CreateWorkshopSettlementDto } from './dto/create-workshop-settlement.dto';
import { CreateWorkshopHoursDto } from './dto/create-workshop-hours.dto';
import { JwtAuthGuard, RolesGuard } from '@/common';


@Controller('workshops')
@UseGuards(JwtAuthGuard, RolesGuard)
export class WorkshopsController {
  constructor(private readonly workshopsService: WorkshopsService) {}

  @Post()
  create(@Body() createWorkshopDto: CreateWorkshopDto) {
    return this.workshopsService.create(createWorkshopDto);
  }

  @Get()
  findAll() {
    return this.workshopsService.findAll();
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.workshopsService.findOne(id);
  }

  @Put(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateWorkshopDto: UpdateWorkshopDto
  ) {
    return this.workshopsService.update(id, updateWorkshopDto);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.workshopsService.remove(id);
  }

  @Post('verify-password')
  verifyPassword(@Body() verifyDto: { workshopId: number; password: string }) {
    return this.workshopsService.verifyWorkshopPassword(
      verifyDto.workshopId,
      verifyDto.password
    );
  }

  @Post(':id/production')
  addProductionRecord(
    @Param('id', ParseIntPipe) id: number,
    @Body() productionDto: CreateWorkshopProductionDto
  ) {
    return this.workshopsService.addProductionRecord(id, productionDto);
  }

  @Post(':id/hours')
  addHoursRecord(
    @Param('id', ParseIntPipe) id: number,
    @Body() hoursDto: CreateWorkshopHoursDto
  ) {
    return this.workshopsService.addHoursRecord(id, hoursDto);
  }

 // في controller
@Post(':id/settlement')
async settleWorkshop(
  @Param('id') id: number,
  @Body() settlementDto: CreateWorkshopSettlementDto,
  @Req() req
) {
  return this.workshopsService.settleWorkshop(
    +id,
    settlementDto,
    req.user.id
  );
}

  @Get(':id/summary')
  getWorkshopSummary(
    @Param('id', ParseIntPipe) id: number,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string
  ) {

    return this.workshopsService.getWorkshopSummary(id);
  }

  @Post(':id/employees/:employeeId')
  addEmployeeToWorkshop(
    @Param('id', ParseIntPipe) id: number,
    @Param('employeeId', ParseIntPipe) employeeId: number
  ) {
    return this.workshopsService.addEmployeeToWorkshop(id, employeeId);
  }

  @Delete(':id/employees/:employeeId')
  removeEmployeeFromWorkshop(
    @Param('id', ParseIntPipe) id: number,
    @Param('employeeId', ParseIntPipe) employeeId: number
  ) {
    return this.workshopsService.removeEmployeeFromWorkshop(id, employeeId);
  }
}