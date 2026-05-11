import { Controller, Get, Patch, Param, Body, UseGuards } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
  ApiHeader,
} from '@nestjs/swagger';
import { UsersService } from './users.service';
import { UpdateProfileDto } from './dto/user.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@ApiTags('Users')
@ApiHeader({
  name: 'x-device-id',
  required: true,
  description: 'Device identifier required for authenticated requests',
})
@Controller('users')
export class UsersController {
  constructor(private usersService: UsersService) {}

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get Current User Profile',
    description: 'Get full profile of authenticated user including wallet balance',
  })
  @ApiResponse({
    status: 200,
    description: 'User profile with wallet',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getMe(@CurrentUser('sub') userId: string): Promise<any> {
    return await this.usersService.getProfile(userId);
  }

  @Patch('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Update User Profile',
    description: 'Update first name, last name, email, or avatar URL',
  })
  @ApiResponse({
    status: 200,
    description: 'Profile updated',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 400, description: 'Invalid data' })
  async updateMe(
    @CurrentUser('sub') userId: string,
    @Body() body: UpdateProfileDto,
  ): Promise<any> {
    return await this.usersService.updateProfile(userId, body);
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get Public User Profile',
    description:
      'Get public profile of another user (name, avatar only). Never exposes phone, email, or virtual account.',
  })
  @ApiParam({ name: 'id', description: 'User ID', example: 'uuid' })
  @ApiResponse({
    status: 200,
    description: 'Public user profile',
  })
  @ApiResponse({ status: 404, description: 'User not found' })
  async getUser(@Param('id') id: string): Promise<any> {
    return await this.usersService.getPublicProfile(id);
  }
}

