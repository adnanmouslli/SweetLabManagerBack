
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
    fundSummaries: FundSummary[];
    totalNet: number;
  }