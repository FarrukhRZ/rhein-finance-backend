import { Controller, Get, Post, UseGuards, Res } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { Response } from 'express';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { Public } from './decorators/public.decorator';
import { CurrentUser } from './decorators/current-user.decorator';
import { User } from '../users/entities/user.entity';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor() {}

  @Get('status')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Check authentication status and get user info' })
  async checkAuth(@CurrentUser() user: User) {
    return {
      success: true,
      authenticated: true,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        partyId: user.partyId,
        profilePicture: user.profilePicture,
      },
    };
  }

  @Post('logout')
  @Public()
  @ApiOperation({ summary: 'Logout user' })
  async logout(@Res() res: Response) {
    return res.json({ success: true, message: 'Logged out successfully' });
  }
}
