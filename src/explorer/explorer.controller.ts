import { Controller, Get, Param, Query, ParseIntPipe, DefaultValuePipe, ForbiddenException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiQuery, ApiBearerAuth } from '@nestjs/swagger';
import { ExplorerService } from './explorer.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity';

@ApiTags('explorer')
@ApiBearerAuth()
@Controller('explorer')
export class ExplorerController {
  constructor(private readonly explorerService: ExplorerService) {}

  private effectivePartyId(user: User, requestedPartyId?: string): string {
    // Admins can query any party; regular users are restricted to their own
    if (requestedPartyId && user.role !== 'admin' && requestedPartyId !== user.partyId) {
      throw new ForbiddenException('You can only view your own transaction history');
    }
    return requestedPartyId || user.partyId;
  }

  @Get('transactions')
  @ApiOperation({ summary: 'Get transaction stream (recent transactions)' })
  @ApiQuery({ name: 'partyId', required: false, example: 'Alice::1220abc...', description: 'DAML party ID (defaults to your own; admin only for other parties)' })
  @ApiQuery({ name: 'offset', required: false, description: 'Pagination offset' })
  @ApiQuery({ name: 'limit', required: false, description: 'Max results (default 100, max 100)' })
  @ApiResponse({ status: 200, description: 'Returns transaction stream' })
  @ApiResponse({ status: 400, description: 'Invalid party ID' })
  async getTransactions(
    @CurrentUser() user: User,
    @Query('partyId') partyId?: string,
    @Query('offset') offset?: string,
    @Query('limit', new DefaultValuePipe(100), ParseIntPipe) limit?: number,
  ) {
    const effectivePartyId = this.effectivePartyId(user, partyId);
    const transactions = await this.explorerService.getTransactions(effectivePartyId, offset, limit);
    return { success: true, data: transactions };
  }

  @Get('transactions/:txId')
  @ApiOperation({ summary: 'Get transaction by ID (like eth_getTransactionByHash)' })
  @ApiParam({ name: 'txId', description: 'Transaction ID' })
  @ApiQuery({ name: 'partyId', required: false, example: 'Alice::1220abc...', description: 'DAML party ID (defaults to your own)' })
  @ApiResponse({ status: 200, description: 'Returns transaction details' })
  @ApiResponse({ status: 404, description: 'Transaction not found' })
  async getTransaction(
    @CurrentUser() user: User,
    @Param('txId') txId: string,
    @Query('partyId') partyId?: string,
  ) {
    const effectivePartyId = this.effectivePartyId(user, partyId);
    const transaction = await this.explorerService.getTransactionById(effectivePartyId, txId);
    return { success: true, data: transaction };
  }

  @Get('contracts/:contractId/history')
  @ApiOperation({ summary: 'Get contract history (all transactions involving a contract)' })
  @ApiParam({ name: 'contractId', description: 'Contract ID' })
  @ApiQuery({ name: 'partyId', required: false, example: 'Alice::1220abc...', description: 'DAML party ID (defaults to your own)' })
  @ApiResponse({ status: 200, description: 'Returns contract history' })
  async getContractHistory(
    @CurrentUser() user: User,
    @Param('contractId') contractId: string,
    @Query('partyId') partyId?: string,
  ) {
    const effectivePartyId = this.effectivePartyId(user, partyId);
    const history = await this.explorerService.getContractHistory(effectivePartyId, contractId);
    return { success: true, data: history };
  }
}
