import { PrismaClient, FundType } from '@prisma/client';

const funds = [
  { 
    fundType: FundType.main, 
    currentBalance: 0 
  },
  { 
    fundType: FundType.general, 
    currentBalance: 0 
  },
  { 
    fundType: FundType.booth, 
    currentBalance: 0 
  },
  { 
    fundType: FundType.university, 
    currentBalance: 0 
  }
  ,
  { 
    fundType: FundType.main_usd, 
    currentBalance: 0 
  }
  ,
  { 
    fundType: FundType.general_usd, 
    currentBalance: 0 
  }
];

export async function seedFunds(prisma: PrismaClient) {
  console.log('Seeding funds...');

  for (const fund of funds) {
    await prisma.fund.create({
      data: fund
    });
  }

  console.log('✅ Funds seeded successfully');
}