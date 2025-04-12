import { PartialType } from '@nestjs/mapped-types';
import { CreateCustomerCategoryDto } from './create-customer-category.dto';

export class UpdateCustomerCategoryDto extends PartialType(CreateCustomerCategoryDto) {}