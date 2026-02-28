import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiQuery } from '@nestjs/swagger';
import { ExplorerService } from './explorer.service';
import { Public } from '../auth/decorators/public.decorator';

@ApiTags('explorer')
@Controller('explorer')
@Public() // Make routes public (add auth later if needed)
export class ExplorerController {
  constructor(private readonly explorerService: ExplorerService) {}

  @Get('transactions')
  @ApiOperation({ summary: 'Get transaction stream (recent transactions)' })
  @ApiQuery({ name: 'partyId', example: 'Alice::1220abc...', description: 'DAML party ID' })
  @ApiQuery({ name: 'offset', required: false, description: 'Pagination offset' })
  @ApiResponse({ status: 200, description: 'Returns transaction stream' })
  @ApiResponse({ status: 400, description: 'Invalid party ID' })
  async getTransactions(
    @Query('partyId') partyId: string,
    @Query('offset') offset?: string
  ) {
    const transactions = await this.explorerService.getTransactions(partyId, offset);
    return { success: true, data: transactions };
  }

  @Get('transactions/:txId')
  @ApiOperation({ summary: 'Get transaction by ID (like eth_getTransactionByHash)' })
  @ApiParam({ name: 'txId', description: 'Transaction ID' })
  @ApiQuery({ name: 'partyId', example: 'Alice::1220abc...', description: 'DAML party ID' })
  @ApiResponse({ status: 200, description: 'Returns transaction details' })
  @ApiResponse({ status: 404, description: 'Transaction not found' })
  @ApiResponse({ status: 400, description: 'Invalid party ID' })
  async getTransaction(
    @Param('txId') txId: string,
    @Query('partyId') partyId: string
  ) {
    const transaction = await this.explorerService.getTransactionById(partyId, txId);
    return { success: true, data: transaction };
  }

  @Get('contracts/:contractId/history')
  @ApiOperation({ summary: 'Get contract history (all transactions involving a contract)' })
  @ApiParam({ name: 'contractId', description: 'Contract ID' })
  @ApiQuery({ name: 'partyId', example: 'Alice::1220abc...', description: 'DAML party ID' })
  @ApiResponse({ status: 200, description: 'Returns contract history' })
  @ApiResponse({ status: 400, description: 'Invalid party ID' })
  async getContractHistory(
    @Param('contractId') contractId: string,
    @Query('partyId') partyId: string
  ) {
    const history = await this.explorerService.getContractHistory(partyId, contractId);
    return { success: true, data: history };
  }
}
