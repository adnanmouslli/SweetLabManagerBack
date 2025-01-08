import { Controller, Param, UseGuards , Post , Get } from '@nestjs/common';
import { TrayTrackingService } from './tray-tracking.service';
import { JwtAuthGuard, Role, Roles, RolesGuard } from '@/common';

@Controller('tray-tracking')
@UseGuards(JwtAuthGuard, RolesGuard)
export class TrayTrackingController {
  constructor(private readonly trayTrackingService: TrayTrackingService) {}


  @Post(':invoiceId/return')
  @Roles(Role.EMPLOYEE, Role.MANAGER)
  async markTraysAsReturned(@Param('invoiceId') invoiceId: string) {
    return this.trayTrackingService.markTraysAsReturned(+invoiceId);
  }

  @Get('pending')
  @Roles(Role.EMPLOYEE, Role.MANAGER)
  async getPendingTrays() {
    return this.trayTrackingService.getPendingTrays();
  }


}
