import { Injectable, BadRequestException } from '@nestjs/common';
import { DamlService } from '../daml/daml.service';

@Injectable()
export class WalletService {
  constructor(private readonly damlService: DamlService) {}

  private ensureOnboarded(partyId: string | null): string {
    if (!partyId) {
      throw new BadRequestException('Wallet not linked. Please complete onboarding first.');
    }
    return partyId;
  }

  async getBalance(partyId: string | null) {
    const party = this.ensureOnboarded(partyId);
    return this.damlService.getTokenBalances(party);
  }

  async transferUSDC(partyId: string | null, recipientPartyId: string, amount: number) {
    const party = this.ensureOnboarded(partyId);
    if (party === recipientPartyId) {
      throw new BadRequestException('Cannot transfer to yourself');
    }
    return this.damlService.transferUSDC(party, recipientPartyId, amount);
  }

  async transferCC(partyId: string | null, recipientPartyId: string, amount: number, userToken?: string) {
    const party = this.ensureOnboarded(partyId);
    if (party === recipientPartyId) {
      throw new BadRequestException('Cannot transfer to yourself');
    }
    return this.damlService.transferCC(party, recipientPartyId, amount, userToken);
  }

  async listTransfers(partyId: string | null, userToken?: string) {
    const party = this.ensureOnboarded(partyId);
    const all = await this.damlService.listTransfers(userToken);
    const transfers = (all.transfers || []).filter(
      (t: any) =>
        t.payload?.sender === party ||
        t.payload?.receiver === party ||
        t.payload?.transfer?.sender === party ||
        t.payload?.transfer?.receiver === party,
    );
    const offers = (all.offers || []).filter(
      (o: any) =>
        o.payload?.sender === party ||
        o.payload?.receiver === party ||
        o.payload?.receiver_party_id === party,
    );
    return { transfers, offers };
  }

  async acceptTransfer(partyId: string | null, transferId: string, userToken?: string) {
    this.ensureOnboarded(partyId);
    return this.damlService.acceptTransfer(transferId, userToken);
  }

  async rejectTransfer(partyId: string | null, transferId: string, userToken?: string) {
    this.ensureOnboarded(partyId);
    return this.damlService.rejectTransfer(transferId, userToken);
  }
}
