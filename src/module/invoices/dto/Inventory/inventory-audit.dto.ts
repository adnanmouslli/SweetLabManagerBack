import { IsArray, IsNumber, IsPositive, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

class InventoryAuditItemDto {
  @IsNumber()
  itemId: number;

  @IsNumber()
  @IsPositive()
  countedStock: number;
}

export class InventoryAuditDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => InventoryAuditItemDto)
  items: InventoryAuditItemDto[];
}