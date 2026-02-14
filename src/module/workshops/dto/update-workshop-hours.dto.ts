import { PartialType } from '@nestjs/mapped-types';
import { CreateWorkshopHoursDto } from './create-workshop-hours.dto';

export class UpdateWorkshopHoursDto extends PartialType(CreateWorkshopHoursDto) {}
