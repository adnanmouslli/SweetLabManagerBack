import { IsNumber, IsString, IsOptional } from 'class-validator';

export class CreatePaymentDto {
  @IsNumber()
  amount: number;

  @IsNumber()
  invoiceId: number;

  @IsString()
  @IsOptional()
  notes?: string;
}