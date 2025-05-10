import { IsString, IsNumber, IsEnum, IsOptional, IsArray, ValidateNested, IsNotEmpty } from 'class-validator';
import { Type } from 'class-transformer';
import { ItemType } from '@prisma/client';
import { UnitDto } from './create-item.dto';

export class UpdateItemDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsEnum(ItemType)
  @IsOptional()
  type?: ItemType;

  @IsString()
  @IsOptional()
  barcode?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UnitDto)
  @IsOptional()
  units?: UnitDto[];

  @IsString()
  @IsOptional()
  defaultUnit?: string;

  @IsNumber()
  @IsOptional()
  price?: number;

  @IsNumber()
  @IsOptional()
  cost?: number;

  @IsNumber()
  @IsOptional()
  productionRate?: number; // سعر الإنتاج للمنتج

  @IsNumber()
  @IsOptional()
  groupId?: number;
}