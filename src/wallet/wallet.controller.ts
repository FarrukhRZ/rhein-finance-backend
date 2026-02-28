import { Controller, Get, Post, Body, Param } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiBearerAuth } from '@nestjs/swagger';
import { WalletService } from './wallet.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity';
import { TransferUsdcDto } from './dto/transfer-usdc.dto';
import { TransferCcDto } from './dto/transfer-cc.dto';

@ApiTags('wallet')
@ApiBearerAuth()
@Controller('wallet')
export class WalletController {
  constructor(private readonly walletService: WalletService) {}

  @Get('balance')
  @ApiOperation({ summary: 'Get current user wallet balances (USDC + CC)' })
  @ApiResponse({ status: 200, description: 'Returns USDC and CC balances' })
  async getBalance(@CurrentUser() user: User) {
    const balances = await this.walletService.getBalance(user.partyId);
    return { success: true, data: balances };
  }

  @Post('transfer/usdc')
  @ApiOperation({ summary: 'Transfer USDC to another party (instant)' })
  @ApiResponse({ status: 200, description: 'USDC transferred successfully' })
  @ApiResponse({ status: 400, description: 'Insufficient balance or invalid recipient' })
  async transferUSDC(
    @CurrentUser() user: User,
    @Body() dto: TransferUsdcDto,
  ) {
    const result = await this.walletService.transferUSDC(
      user.partyId,
      dto.recipientPartyId,
      dto.amount,
    );
    return { success: true, data: result };
  }

  @Post('transfer/cc')
  @ApiOperation({ summary: 'Transfer CC to another party (creates transfer instruction, recipient must accept)' })
  @ApiResponse({ status: 200, description: 'CC transfer instruction created' })
  @ApiResponse({ status: 400, description: 'Insufficient balance or invalid recipient' })
  async transferCC(
    @CurrentUser() user: User,
    @Body() dto: TransferCcDto,
  ) {
    const result = await this.walletService.transferCC(
      user.partyId,
      dto.recipientPartyId,
      dto.amount,
      user.rawToken,
    );
    return { success: true, data: result };
  }

  @Get('transfers')
  @ApiOperation({ summary: 'List pending CC transfers (token-standard + legacy transfer offers)' })
  @ApiResponse({ status: 200, description: 'Returns list of pending transfers' })
  async listTransfers(@CurrentUser() user: User) {
    const transfers = await this.walletService.listTransfers(user.partyId, user.rawToken);
    return { success: true, data: transfers };
  }

  @Post('transfers/:transferId/accept')
  @ApiOperation({ summary: 'Accept an incoming CC transfer' })
  @ApiParam({ name: 'transferId', description: 'Transfer contract ID' })
  @ApiResponse({ status: 200, description: 'Transfer accepted' })
  async acceptTransfer(
    @CurrentUser() user: User,
    @Param('transferId') transferId: string,
  ) {
    const result = await this.walletService.acceptTransfer(user.partyId, transferId, user.rawToken);
    return { success: true, data: result };
  }

  @Post('transfers/:transferId/reject')
  @ApiOperation({ summary: 'Reject/withdraw a CC transfer' })
  @ApiParam({ name: 'transferId', description: 'Transfer contract ID' })
  @ApiResponse({ status: 200, description: 'Transfer rejected/withdrawn' })
  async rejectTransfer(
    @CurrentUser() user: User,
    @Param('transferId') transferId: string,
  ) {
    const result = await this.walletService.rejectTransfer(user.partyId, transferId, user.rawToken);
    return { success: true, data: result };
  }
}
