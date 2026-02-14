import { PartialType } from '@nestjs/mapped-types';
import { CreateWorkshopProductionDto } from './create-workshop-production.dto';

export class UpdateWorkshopProductionDto extends PartialType(CreateWorkshopProductionDto) {}
