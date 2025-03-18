import { PrismaClient, Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const users = [
  {
    username: 'admin',
    password: 'admin123',
    roles: [Role.ADMIN],
  },
  {
    username: 'manager',
    password: '123',
    roles: [Role.MANAGER],
  },
  {
    username: 'user1',
    password: '123',
    roles: [Role.ShiftManager],
  },
  {
    username: 'user2',
    password: '123',
    roles: [Role.TreasuryManager],
  },
  {
    username: 'user3',
    password: '123',
    roles: [Role.TrayManager],
  },

];

export async function seedUsers(prisma: PrismaClient) {
  console.log('Seeding users...');

  for (const user of users) {
    await prisma.user.create({
      data: {
        ...user,
        password: await bcrypt.hash(user.password, 10),
      },
    });
  }
  
  console.log('✅ Users seeded successfully');
}