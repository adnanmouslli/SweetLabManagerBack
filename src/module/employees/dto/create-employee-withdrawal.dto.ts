import { IsEnum, IsNumber, IsOptional, IsString } from 'class-validator';

export class CreateEmployeeWithdrawalDto {
  @IsNumber()
  amount: number;

  @IsEnum(['salary_advance', 'debt'])
  withdrawalType: string;

  @IsNumber()
  fundId: number;

  @IsString()
  @IsOptional()
  notes?: string;
}