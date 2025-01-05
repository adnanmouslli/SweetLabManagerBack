import { PrismaClient, FundType } from '@prisma/client';

const funds = [
  { 
    fundType: FundType.main, 
    currentBalance: 50000 
  },
  { 
    fundType: FundType.general, 
    currentBalance: 10000 
  },
  { 
    fundType: FundType.booth, 
    currentBalance: 5000 
  },
  { 
    fundType: FundType.university, 
    currentBalance: 8000 
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