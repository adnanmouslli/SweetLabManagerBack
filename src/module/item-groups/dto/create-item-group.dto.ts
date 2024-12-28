import { IsString, IsEnum, IsOptional } from 'class-validator';
import { ItemType } from '@prisma/client';

export class CreateItemGroupDto {
  @IsString()
  name: string;

  @IsEnum(ItemType)
  type: ItemType;

  @IsString()
  @IsOptional()
  description?: string;
}