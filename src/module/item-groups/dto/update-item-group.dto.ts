import { PartialType } from '@nestjs/mapped-types';
import { CreateItemGroupDto } from './create-item-group.dto';

export class UpdateItemGroupDto extends PartialType(CreateItemGroupDto) {}