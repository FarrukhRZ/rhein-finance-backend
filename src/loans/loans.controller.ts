import { Controller, Get, Post, Body, Param, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiQuery, ApiBearerAuth } from '@nestjs/swagger';
import { LoansService } from './loans.service';
import { Public } from '../auth/decorators/public.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity';
import { CreateOfferDto } from './dto/create-offer.dto';
import { AcceptOfferDto } from './dto/accept-offer.dto';
import { RepayLoanDto } from './dto/repay-loan.dto';
import { DefaultLoanDto } from './dto/default-loan.dto';
import { IssueTokensDto } from './dto/issue-tokens.dto';

@ApiTags('loans', 'offers', 'balances')
@ApiBearerAuth()
@Controller()
export class LoansController {
  constructor(private readonly loansService: LoansService) {}

  // ========== OFFER ENDPOINTS ==========

  @Public()
  @Get('offers/all')
  @ApiOperation({ summary: 'Get all loan offers (marketplace view - public)' })
  @ApiResponse({ status: 200, description: 'Returns all loan offers' })
  async getAllOffers() {
    const offers = await this.loansService.getAllOffers();
    return { success: true, data: offers, count: offers.length };
  }

  @Get('offers')
  @ApiOperation({ summary: 'Get loan offers for a specific party' })
  @ApiQuery({ name: 'partyId', example: 'Alice::1220abc...', description: 'DAML party ID' })
  @ApiResponse({ status: 200, description: 'Returns loan offers for the party' })
  @ApiResponse({ status: 400, description: 'Invalid party ID or missing partyId' })
  async getOffers(@Query('partyId') partyId: string) {
    const offers = await this.loansService.getOffers(partyId);
    return { success: true, data: offers };
  }

  @Post('offers')
  @ApiOperation({ summary: 'Create a new loan offer' })
  @ApiResponse({ status: 201, description: 'Loan offer created successfully' })
  @ApiResponse({ status: 400, description: 'Invalid input or party ID' })
  async createOffer(@CurrentUser() user: User, @Body() dto: CreateOfferDto) {
    const result = await this.loansService.createOffer({ ...dto, partyId: user.partyId }, user.rawToken);
    return { success: true, data: result };
  }

  @Post('offers/:contractId/accept')
  @ApiOperation({ summary: 'Accept a loan offer' })
  @ApiParam({ name: 'contractId', description: 'The contract ID of the loan offer' })
  @ApiResponse({ status: 200, description: 'Offer accepted successfully' })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  async acceptOffer(
    @CurrentUser() user: User,
    @Param('contractId') contractId: string,
    @Body() dto: AcceptOfferDto
  ) {
    const result = await this.loansService.acceptOffer(contractId, user.partyId, dto.offer, user.rawToken);
    return { success: true, data: result };
  }

  // ========== LOAN ENDPOINTS ==========

  @Get('loans')
  @ApiOperation({ summary: 'Get active loans for a specific party' })
  @ApiQuery({ name: 'partyId', example: 'Alice::1220abc...', description: 'DAML party ID' })
  @ApiResponse({ status: 200, description: 'Returns active loans' })
  @ApiResponse({ status: 400, description: 'Invalid party ID' })
  async getLoans(@Query('partyId') partyId: string) {
    const loans = await this.loansService.getActiveLoans(partyId);
    return { success: true, data: loans };
  }

  @Post('loans/:contractId/repay')
  @ApiOperation({ summary: 'Repay a loan' })
  @ApiParam({ name: 'contractId', description: 'The contract ID of the active loan' })
  @ApiResponse({ status: 200, description: 'Loan repaid successfully' })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  async repayLoan(
    @CurrentUser() user: User,
    @Param('contractId') contractId: string,
    @Body() dto: RepayLoanDto
  ) {
    const result = await this.loansService.repayLoan(
      contractId,
      user.partyId,
      dto.repaymentAmount,
      user.rawToken,
    );
    return { success: true, data: result };
  }

  @Post('loans/:contractId/default')
  @ApiOperation({ summary: 'Claim default on a matured loan' })
  @ApiParam({ name: 'contractId', description: 'The contract ID of the active loan' })
  @ApiResponse({ status: 200, description: 'Default claimed successfully' })
  @ApiResponse({ status: 400, description: 'Loan not matured or invalid input' })
  async defaultLoan(
    @CurrentUser() user: User,
    @Param('contractId') contractId: string,
    @Body() dto: DefaultLoanDto
  ) {
    const result = await this.loansService.defaultLoan(contractId, user.partyId, dto.claimDate, user.rawToken);
    return { success: true, data: result };
  }

  // ========== BALANCE ENDPOINTS ==========

  @Public()
  @Get('balances/:party')
  @ApiOperation({ summary: 'Get token balances for a party' })
  @ApiParam({ name: 'party', example: 'Alice::1220abc...', description: 'DAML party ID' })
  @ApiResponse({ status: 200, description: 'Returns USDC and CC balances' })
  @ApiResponse({ status: 400, description: 'Invalid party ID' })
  async getBalances(@Param('party') partyId: string) {
    const balances = await this.loansService.getBalances(partyId);
    return { success: true, data: balances };
  }

  // ========== FAUCET ENDPOINTS ==========

  @Public()
  @Post('faucet/issue')
  @ApiOperation({ summary: 'Issue USDC test tokens to a party (CC comes from real Canton Coins)' })
  @ApiResponse({ status: 200, description: 'USDC issued successfully' })
  @ApiResponse({ status: 400, description: 'Invalid party ID' })
  async issueTokens(@Body() dto: IssueTokensDto) {
    const result = await this.loansService.issueTokens(dto.partyId);
    return {
      success: result.success,
      message: result.message
    };
  }
}
