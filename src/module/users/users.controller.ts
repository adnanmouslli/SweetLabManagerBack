import { Controller, Post, Body, Get, UseGuards } from '@nestjs/common';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { request } from 'http';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { Role, Roles, RolesGuard, User } from 'src/common';

@Controller('users')
@UseGuards(JwtAuthGuard , RolesGuard)
@Roles(Role.EMPLOYEE)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}
  
  @Post('createUser')
  async register(@Body() createUserDto: CreateUserDto) {
    return this.usersService.create(createUserDto);
  }

  @Get('testUser')
  async testAdmin(@User('roles') userRoles) {
    return 'Admin created successfully:' + userRoles;
  }

}