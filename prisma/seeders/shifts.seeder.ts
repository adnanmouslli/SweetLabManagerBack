import { PrismaClient } from '@prisma/client';

function generatePastDate(daysAgo: number) {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  return date;
}

export async function seedShifts(prisma: PrismaClient) {
  console.log('Seeding shifts...');

  const employees = await prisma.user.findMany({
    where: {
      roles: {
        has: 'EMPLOYEE'
      }
    }
  });

  for (let i = 0; i < 5; i++) {
    const date = generatePastDate(i);
    const employeeIndex = i % employees.length;
  
    await prisma.shift.create({
      data: {
        shiftType: 'morning',
        status: 'closed',
        openTime: new Date(date.setHours(8, 0, 0, 0)),
        closeTime: new Date(date.setHours(16, 0, 0, 0)),
        employeeId: employees[employeeIndex].id,
        differenceStatus: Math.random() > 0.5 ? 'surplus' : 'deficit', 
        differenceValue: parseFloat((Math.random() * 50 + 1).toFixed(2)), 
      },
    });
  
    await prisma.shift.create({
      data: {
        shiftType: 'evening',
        status: 'closed',
        openTime: new Date(date.setHours(16, 0, 0, 0)),
        closeTime: new Date(date.setHours(23, 59, 59, 999)),
        employeeId: employees[(employeeIndex + 1) % employees.length].id,
        differenceStatus: Math.random() > 0.5 ? 'surplus' : 'deficit', 
        differenceValue: parseFloat((Math.random() * 50 + 1).toFixed(2)), 
      },
    });
  }
  
  await prisma.shift.create({
    data: {
      shiftType: 'morning',
      status: 'open',
      openTime: new Date(),
      employeeId: employees[0].id,
      differenceStatus: null, 
      differenceValue: null, 
    },
  });
  
  console.log('✅ Shifts seeded successfully');
}