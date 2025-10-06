import { IsString, IsNumber, IsEnum, IsOptional, IsArray, ValidateNested, IsNotEmpty } from 'class-validator';
import { Type } from 'class-transformer';
import { ItemType } from '@prisma/client';

// نموذج لوحدة القياس
export class UnitDto {
  @IsString()
  @IsNotEmpty()
  unit: string;

  @IsNumber()
  price: number;

  @IsNumber()
  factor: number; // معامل التحويل بالنسبة للوحدة الأساسية (الوحدة الأولى عادة ما تكون معاملها 1)
}

export class CreateItemDto {
  @IsString()
  name: string;

  @IsEnum(ItemType)
  type: ItemType;

  @IsString()
  @IsOptional()
  barcode?: string;

  @IsString()
  @IsOptional()
  description?: string;

  // مصفوفة ديناميكية من وحدات القياس
  @IsArray()
  @Type(() => UnitDto)
  units: UnitDto[];

  // الوحدة الافتراضية للبيع
  @IsString()
  defaultUnit: string;


  @IsNumber()
  @IsOptional()
  basePrice?: number;        // السعر الأساسي
  
  @IsNumber()
  @IsOptional()
  packagingPrice?: number;   // سعر التكييس (افتراضي 0)
  
  @IsNumber()
  @IsOptional()
  deliveryPrice?: number;    // سعر التوصيل (افتراضي 0)


  // سعر البيع للوحدة الافتراضية (سيتم حسابه تلقائيًا بناءً على الوحدة الافتراضية)
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
  groupId: number;
}