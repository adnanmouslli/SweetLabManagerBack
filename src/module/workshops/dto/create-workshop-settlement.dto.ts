
export class ManualDistributionDto {
  employeeId: number;
  amount: number;
  notes?: string;
}

export class CreateWorkshopSettlementDto {
  fundId: number;
  amount: number;
  notes?: string;
  distributeImmediately?: boolean;
  distributionType?: 'manual' | 'automatic';
  manualDistributions?: ManualDistributionDto[];
  lastSettlementDate?: Date;
  salaryPaymentType?: string; // لتحديد نوع الدفعة (daily, weekly, monthly, workshop)
}
