import { IsArray, IsDate, IsNumber, IsOptional, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

class ProductionItemDto {
  @IsNumber()
  itemId: number;
  
  @IsNumber()
  quantity: number;
}

export class CreateWorkshopProductionDto {
  @IsOptional()
  @IsDate()
  @Type(() => Date)
  date?: Date;
  
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProductionItemDto)
  items: ProductionItemDto[];
  
  @IsString()
  @IsOptional()
  notes?: string;
}