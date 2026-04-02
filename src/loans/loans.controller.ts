import { Controller, Get, Post, Body, Param, ForbiddenException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiBearerAuth } from '@nestjs/swagger';
import { LoansService } from './loans.service';
import { Public } from '../auth/decorators/public.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity';
import { CreateOfferDto } from './dto/create-offer.dto';
import { RepayLoanDto } from './dto/repay-loan.dto';
import { DefaultLoanDto } from './dto/default-loan.dto';

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
  @ApiOperation({ summary: 'Get loan offers for the authenticated party' })
  @ApiResponse({ status: 200, description: 'Returns loan offers for the party' })
  @ApiResponse({ status: 400, description: 'Invalid party ID' })
  async getOffers(@CurrentUser() user: User) {
    const offers = await this.loansService.getOffers(user.partyId);
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
  ) {
    // Offer payload is fetched from the ledger inside the service — no body needed
    const result = await this.loansService.acceptOffer(contractId, user.partyId, user.rawToken);
    return { success: true, data: result };
  }

  // ========== LOAN ENDPOINTS ==========

  @Get('loans')
  @ApiOperation({ summary: 'Get active loans for the authenticated party' })
  @ApiResponse({ status: 200, description: 'Returns active loans' })
  @ApiResponse({ status: 400, description: 'Invalid party ID' })
  async getLoans(@CurrentUser() user: User) {
    const loans = await this.loansService.getActiveLoans(user.partyId);
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
    // claimDate override is admin-only — regular users always use today's date
    if (dto.claimDate && user.role !== 'admin') {
      throw new ForbiddenException('claimDate override requires admin role');
    }
    const result = await this.loansService.defaultLoan(contractId, user.partyId, dto.claimDate, user.rawToken);
    return { success: true, data: result };
  }

  // ========== BALANCE ENDPOINTS ==========

  @Get('balances')
  @ApiOperation({ summary: 'Get token balances for the authenticated party' })
  @ApiResponse({ status: 200, description: 'Returns USDC and CC balances' })
  @ApiResponse({ status: 400, description: 'Invalid party ID' })
  async getBalances(@CurrentUser() user: User) {
    const balances = await this.loansService.getBalances(user.partyId);
    return { success: true, data: balances };
  }

}
