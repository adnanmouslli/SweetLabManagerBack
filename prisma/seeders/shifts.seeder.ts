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

  // إنشاء ورديات للأيام الماضية
  for (let i = 0; i < 5; i++) {
    const date = generatePastDate(i);
    const employeeIndex = i % employees.length;
    
    // واردية صباحية
    await prisma.shift.create({
      data: {
        shiftType: 'morning',
        status: 'closed',
        openTime: new Date(date.setHours(8, 0, 0, 0)),
        closeTime: new Date(date.setHours(16, 0, 0, 0)),
        employeeId: employees[employeeIndex].id,
      },
    });

    // واردية مسائية
    await prisma.shift.create({
      data: {
        shiftType: 'evening',
        status: 'closed',
        openTime: new Date(date.setHours(16, 0, 0, 0)),
        closeTime: new Date(date.setHours(23, 59, 59, 999)),
        employeeId: employees[(employeeIndex + 1) % employees.length].id,
      },
    });
  }

  // واردية مفتوحة حالية
  await prisma.shift.create({
    data: {
      shiftType: 'morning',
      status: 'open',
      openTime: new Date(),
      employeeId: employees[0].id,
    },
  });

  console.log('✅ Shifts seeded successfully');
}