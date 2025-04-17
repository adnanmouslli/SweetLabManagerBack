import { IsString, IsOptional } from 'class-validator';

export class CreateOrderCategoryDto {
  @IsString()
  name: string;
  
  @IsString()
  @IsOptional()
  description?: string;
}