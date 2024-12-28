import { IsString, IsArray, IsEnum, MinLength } from 'class-validator';
import { Role } from '@prisma/client';

export class CreateUserDto {
  @IsString()
  username: string;

  @IsString()
  @MinLength(6)
  password: string;

  @IsArray()
  @IsEnum(Role, { each: true })
  roles: Role[];
}