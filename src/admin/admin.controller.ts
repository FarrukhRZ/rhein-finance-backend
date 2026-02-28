import { Controller, Get, Post, Body, Param, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiQuery, ApiBearerAuth } from '@nestjs/swagger';
import { AdminService } from './admin.service';
import { Roles } from '../auth/decorators/roles.decorator';
import { CreatePartyDto } from './dto/create-party.dto';
import { ApproveDepositDto } from './dto/approve-deposit.dto';
import { OnboardUserDto } from './dto/onboard-user.dto';

@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin')
@Roles('admin')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Post('parties/create')
  @ApiOperation({ summary: 'Create a new party on the Canton ledger' })
  @ApiResponse({ status: 201, description: 'Party created successfully' })
  @ApiResponse({ status: 400, description: 'Invalid display name' })
  async createParty(@Body() dto: CreatePartyDto) {
    const party = await this.adminService.createParty(dto.displayName);
    return {
      success: true,
      party,
      message: `Party '${dto.displayName}' created successfully. Credentials can now be distributed to users.`
    };
  }

  @Post('users/:userId/onboard')
  @ApiOperation({ summary: 'Onboard a user: allocate Canton party and issue initial USDC' })
  @ApiParam({ name: 'userId', description: 'User ID (UUID) from the users table' })
  @ApiResponse({ status: 200, description: 'User onboarded successfully' })
  @ApiResponse({ status: 400, description: 'User already onboarded' })
  @ApiResponse({ status: 404, description: 'User not found' })
  async onboardUser(
    @Param('userId') userId: string,
    @Body() dto: OnboardUserDto,
  ) {
    return this.adminService.onboardUser(userId, dto.initialUsdcAmount);
  }

  @Post('deposits/approve')
  @ApiOperation({ summary: 'Approve a deposit and issue tokens to a party' })
  @ApiResponse({ status: 200, description: 'Deposit approved and tokens issued' })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  async approveDeposit(@Body() dto: ApproveDepositDto) {
    return this.adminService.approveDeposit(dto);
  }

  @Get('parties/list')
  @ApiOperation({ summary: 'List all created parties' })
  @ApiResponse({ status: 200, description: 'Returns list of all parties' })
  async listParties() {
    const parties = await this.adminService.getAllParties();
    return {
      success: true,
      parties,
      count: parties.length,
      userPartyCount: parties.filter(p => !p.isIssuer).length,
    };
  }

  @Get('deposits/history')
  @ApiOperation({ summary: 'Get deposit history with optional filters' })
  @ApiQuery({ name: 'partyId', required: false, description: 'Filter by party ID' })
  @ApiQuery({ name: 'status', required: false, enum: ['pending', 'approved', 'completed', 'failed'], description: 'Filter by status' })
  @ApiQuery({ name: 'assetType', required: false, enum: ['USDC', 'CC'], description: 'Filter by asset type' })
  @ApiResponse({ status: 200, description: 'Returns deposit history' })
  async getDepositHistory(
    @Query('partyId') partyId?: string,
    @Query('status') status?: string,
    @Query('assetType') assetType?: string,
  ) {
    const deposits = await this.adminService.getDepositHistory({
      partyId,
      status,
      assetType,
    });

    return {
      success: true,
      deposits,
      count: deposits.length,
    };
  }

  @Get('deposits/:id')
  @ApiOperation({ summary: 'Get a specific deposit by ID' })
  @ApiParam({ name: 'id', description: 'Deposit ID (UUID)' })
  @ApiResponse({ status: 200, description: 'Returns deposit details' })
  @ApiResponse({ status: 404, description: 'Deposit not found' })
  async getDeposit(@Param('id') id: string) {
    const deposit = await this.adminService.getDepositById(id);
    return {
      success: true,
      deposit,
    };
  }

  @Get('stats')
  @ApiOperation({ summary: 'Get admin dashboard statistics' })
  @ApiResponse({ status: 200, description: 'Returns dashboard statistics' })
  async getStats() {
    const stats = await this.adminService.getStats();
    return {
      success: true,
      stats,
    };
  }

  @Post('database/clear')
  @ApiOperation({
    summary: 'Clear all database records',
    description: 'Deletes all parties and deposits from the database. Useful when restarting the ledger.'
  })
  @ApiResponse({ status: 200, description: 'Database cleared successfully' })
  async clearDatabase() {
    return this.adminService.clearDatabase();
  }
}
