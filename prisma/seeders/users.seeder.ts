import { PrismaClient, Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const users = [
  {
    username: 'admin',
    password: 'admin123',
    roles: [Role.ADMIN, Role.MANAGER],
  },
  {
    username: 'manager1',
    password: 'password123',
    roles: [Role.MANAGER],
  },
  {
    username: 'manager2',
    password: 'password123',
    roles: [Role.MANAGER],
  },
  {
    username: 'employee1',
    password: 'password123',
    roles: [Role.EMPLOYEE],
  },
  {
    username: 'employee2',
    password: 'password123',
    roles: [Role.EMPLOYEE],
  },
  {
    username: 'employee3',
    password: 'password123',
    roles: [Role.EMPLOYEE],
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