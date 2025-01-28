
export interface FundSummary {
    fundType: string;
    invoiceCount: number;
    incomeTotal: number;
    expenseTotal: number;
    netTotal: number;
  }
  
  export interface ShiftSummary {
    shiftId: number;
    employeeName: string;
    openTime: Date;
    closedTime?: Date;
    fundSummaries: FundSummary[];
    totalNet: number;
    differenceStatus?: 'surplus' | 'deficit' | null;
    differenceValue?: number | null; 
  }