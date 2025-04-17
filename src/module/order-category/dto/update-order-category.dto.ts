import { IsString, IsOptional } from 'class-validator';

export class UpdateOrderCategoryDto {
    @IsString()
    @IsOptional()
    name?: string;
    
    @IsString()
    @IsOptional()
    description?: string;
  }