// prisma/seeders/item-groups.seeder.ts
import { PrismaClient, ItemType } from '@prisma/client';

const itemGroups = [
  { name: 'معجنات', type: ItemType.production, description: 'تشمل جميع أنواع المعجنات' },
  { name: 'حلويات شرقية', type: ItemType.production, description: 'حلويات عربية تقليدية' },
  { name: 'كيك', type: ItemType.production, description: 'كيك وتورت' },
  { name: 'مواد أساسية', type: ItemType.raw, description: 'المواد الأولية الأساسية' },
  { name: 'مكسرات', type: ItemType.raw, description: 'جميع أنواع المكسرات' },
  { name: 'مواد تغليف', type: ItemType.raw, description: 'مواد التعبئة والتغليف' },
];

export async function seedItemGroups(prisma: PrismaClient) {
  console.log('Seeding item groups...');

  for (const group of itemGroups) {
    await prisma.itemGroup.create({
      data: group,
    });
  }

  console.log('✅ Item groups seeded successfully');
}