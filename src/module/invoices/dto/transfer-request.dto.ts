import { IsEnum, IsOptional } from "class-validator";

export class TransferToBoothUniversityDto {
    sourceId: number;
    amount: number;
    notes?: string;
  }
  
export class TransferToMainRequestDto {
  amount: number;
  notes?: string;

  @IsOptional()
  currency?: 'SYP' | 'USD';
}
  
  export class ConfirmTransferDto {
    confirm: boolean;
    rejectionReason?: string;
  }
  
  export class TransferHistoryQueryDto {
    status?: string;
    startDate?: Date;
    endDate?: Date;
    requestedById?: number;
  }