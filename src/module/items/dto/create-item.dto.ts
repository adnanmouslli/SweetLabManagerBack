import { IsString, IsNumber, IsEnum } from 'class-validator';
import { ItemType } from '@prisma/client';

export class CreateItemDto {
  @IsString()
  name: string;

  @IsEnum(ItemType)
  type: ItemType;

  @IsString()
  unit: string;

  @IsNumber()
  price: number;

  @IsString()
  description?: string;

  @IsNumber()
  groupId: number;
}