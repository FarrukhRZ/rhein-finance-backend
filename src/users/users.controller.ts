import { Controller, Get, Post, Body, UseGuards, BadRequestException } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { UsersService } from './users.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from './entities/user.entity';
import { LinkWalletDto } from './dto/link-wallet.dto';

@ApiTags('users')
@Controller('users')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth('JWT-auth')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  @ApiOperation({ summary: 'Get current user profile' })
  async getProfile(@CurrentUser() user: User) {
    return {
      success: true,
      data: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        profilePicture: user.profilePicture,
        role: user.role,
        partyId: user.partyId,
        createdAt: user.createdAt,
        parties: user.parties || [],
      },
    };
  }

  @Post('me/link-wallet')
  @ApiOperation({ summary: 'Link a Canton wallet party ID to your account' })
  @ApiResponse({ status: 200, description: 'Wallet linked successfully' })
  @ApiResponse({ status: 400, description: 'Invalid party ID or already linked' })
  async linkWallet(
    @CurrentUser() user: User,
    @Body() dto: LinkWalletDto,
  ) {
    if (user.partyId) {
      throw new BadRequestException(
        `Wallet already linked: ${user.partyId}. Contact admin to change it.`,
      );
    }

    // Check if this party ID is already linked to another user
    const existingUser = await this.usersService.findByPartyId(dto.partyId);
    if (existingUser) {
      throw new BadRequestException('This party ID is already linked to another account.');
    }

    await this.usersService.update(user.id, { partyId: dto.partyId });

    return {
      success: true,
      message: 'Wallet linked successfully',
      partyId: dto.partyId,
    };
  }
}
