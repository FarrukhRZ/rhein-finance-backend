import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { DamlService } from '../daml/daml.service';

@Injectable()
export class ExplorerService {
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

  async getTransactions(partyId: string, offset?: string) {
    this.ensureValidPartyId(partyId);
    return this.damlService.getTransactionStream(partyId, offset);
  }

  async getTransactionById(partyId: string, txId: string) {
    this.ensureValidPartyId(partyId);
    const transaction = await this.damlService.getTransactionById(partyId, txId);

    if (!transaction) {
      throw new NotFoundException('Transaction not found');
    }

    return transaction;
  }

  async getContractHistory(partyId: string, contractId: string) {
    this.ensureValidPartyId(partyId);
    return this.damlService.getContractHistory(partyId, contractId);
  }
}
