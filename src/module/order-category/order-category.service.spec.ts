import { Test, TestingModule } from '@nestjs/testing';
import { OrderCategoryService } from './order-category.service';

describe('OrderCategoryService', () => {
  let service: OrderCategoryService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [OrderCategoryService],
    }).compile();

    service = module.get<OrderCategoryService>(OrderCategoryService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
