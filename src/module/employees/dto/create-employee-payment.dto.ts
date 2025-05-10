import { IsEnum, IsNumber, IsOptional, IsString } from 'class-validator';

export class CreateEmployeePaymentDto {
  @IsNumber()
  amount: number;

  @IsEnum(['returnWithdrawal', 'debtPayment'])
  paymentType: string;

  @IsNumber()
  fundId: number;

  @IsString()
  @IsOptional()
  notes?: string;
}