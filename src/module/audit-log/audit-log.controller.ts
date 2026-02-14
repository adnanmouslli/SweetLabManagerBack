import { Controller, Get, Param, Query, UseGuards, ParseIntPipe } from '@nestjs/common';
import { AuditLogService } from './audit-log.service';
import { QueryAuditLogDto } from './dto/query-audit-log.dto';
import { JwtAuthGuard, Role, Roles, RolesGuard } from '../../common';

@Controller('audit-logs')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.MANAGER)
export class AuditLogController {
  constructor(private readonly auditLogService: AuditLogService) {}

  @Get()
  findAll(@Query() query: QueryAuditLogDto) {
    return this.auditLogService.findAll(query);
  }

  @Get('summary')
  getActionSummary(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.auditLogService.getActionSummary(startDate, endDate);
  }

  @Get('entity/:entity/:entityId')
  getEntityHistory(
    @Param('entity') entity: string,
    @Param('entityId', ParseIntPipe) entityId: number,
  ) {
    return this.auditLogService.getEntityHistory(entity, entityId);
  }

  @Get('user/:userId')
  getUserActivity(
    @Param('userId', ParseIntPipe) userId: number,
    @Query('limit') limit?: string,
  ) {
    return this.auditLogService.getUserActivity(userId, limit ? parseInt(limit) : 50);
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.auditLogService.findOne(id);
  }
}
