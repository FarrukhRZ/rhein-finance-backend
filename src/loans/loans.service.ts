import { Injectable, BadRequestException } from '@nestjs/common';
import { DamlService } from '../daml/daml.service';
import { LoanOffer } from '../daml/interfaces';

@Injectable()
export class LoansService {
  constructor(private damlService: DamlService) {}

  // Helper to validate party ID format
  private validatePartyId(partyId: string): boolean {
    return partyId.includes('::') && partyId.includes('1220');
  }

  private ensureValidPartyId(partyId: string): void {
    if (!this.validatePartyId(partyId)) {
      throw new BadRequestException('Invalid party ID format. Expected format: partyName::1220...');
    }
  }

  async getAllOffers() {
    return this.damlService.queryAllLoanOffers();
  }

  async getOffers(partyId: string) {
    this.ensureValidPartyId(partyId);
    return this.damlService.queryLoanOffers(partyId);
  }

  async getActiveLoans(partyId: string) {
    this.ensureValidPartyId(partyId);
    return this.damlService.queryActiveLoans(partyId);
  }

  async getBalances(partyId: string) {
    this.ensureValidPartyId(partyId);
    return this.damlService.getTokenBalances(partyId);
  }

  async issueTokens(partyId: string) {
    this.ensureValidPartyId(partyId);
    return this.damlService.issueTokensToParty(partyId);
  }

  async createOffer(data: {
    partyId: string;
    offerType: 'BorrowerBid' | 'LenderAsk';
    loanAmount: string;
    collateralAmount: string;
    interestRate: string;
    maturityDate: string;
  }, userToken?: string) {
    this.ensureValidPartyId(data.partyId);
    return this.damlService.createLoanOffer(data.partyId, {
      offerType: data.offerType,
      loanAmount: data.loanAmount,
      collateralAmount: data.collateralAmount,
      interestRate: data.interestRate,
      maturityDate: data.maturityDate,
    }, userToken);
  }

  async acceptOffer(contractId: string, partyId: string, offer: LoanOffer, userToken?: string) {
    this.ensureValidPartyId(partyId);
    return this.damlService.acceptLoanOffer(partyId, contractId, offer, userToken);
  }

  async repayLoan(contractId: string, partyId: string, repaymentAmount: number, userToken?: string) {
    this.ensureValidPartyId(partyId);
    return this.damlService.repayLoan(partyId, contractId, repaymentAmount, userToken);
  }

  async defaultLoan(contractId: string, partyId: string, claimDate?: string, userToken?: string) {
    this.ensureValidPartyId(partyId);
    return this.damlService.defaultLoan(partyId, contractId, claimDate, userToken);
  }
}
