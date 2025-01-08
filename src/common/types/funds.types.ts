export interface TransferResult {
    success: boolean;
    message: string;
    transfer?: {
      amount: number;
      fromBalance: number;
      toBalance: number;
      transferredBy: string;
      transferredAt: Date;
    };
  }
