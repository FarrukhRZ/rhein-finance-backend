import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as http from 'http';
import * as https from 'https';
import {
  LoanOffer,
  ActiveLoan,
  TokenBalance,
  Transaction,
  Amulet,
  AmuletAmount,
  LockedAmulet,
} from './interfaces';

@Injectable()
export class DamlService {
  private readonly jsonApiUrl: string;
  private readonly packageId: string;
  private readonly adminPartyId: string;
  private readonly damlUserId: string;
  private readonly ccPrice: number;
  private readonly defaultLtv: number;
  private readonly amuletPackageId: string;
  private readonly dsoPartyId: string;
  private readonly validatorWalletUrl: string;
  private readonly validatorAuthAudience: string;
  private readonly auth0TokenUrl: string;
  private readonly auth0ClientId: string;
  private readonly auth0ClientSecret: string;
  private readonly ledgerApiAuthAudience: string;
  private readonly usdcxAdminPartyId: string;
  private readonly usdcxUtilityBackendUrl: string;
  private readonly usdcxBridgeOperatorPartyId: string;
  private readonly usdcxUtilityOperatorPartyId: string;

  // Cached Auth0 tokens (keyed by audience)
  private tokenCache: Map<string, { token: string; expiresAt: number }> = new Map();
  // Cached USDCx Burn Mint Factory context (changes infrequently)
  private usdcxContextCache: { factoryId: string; choiceContextData: any; disclosedContracts: any[]; cachedAt: number } | null = null;

  constructor(private configService: ConfigService) {
    this.jsonApiUrl = this.configService.get('JSON_API_URL') || 'http://172.18.0.5:7575';
    this.packageId = this.configService.get('PACKAGE_ID') || '';
    this.adminPartyId = this.configService.get('ADMIN_PARTY_ID') || '';
    this.damlUserId = this.configService.get('DAML_USER_ID') || 'administrator';
    this.ccPrice = parseFloat(this.configService.get('CC_PRICE') || '0.125');
    this.defaultLtv = parseFloat(this.configService.get('DEFAULT_LTV') || '0.50');
    this.amuletPackageId = this.configService.get('AMULET_PACKAGE_ID') || '';
    this.dsoPartyId = this.configService.get('DSO_PARTY_ID') || '';
    this.validatorWalletUrl = this.configService.get('VALIDATOR_WALLET_URL') || 'http://172.18.0.6:5003';
    this.validatorAuthAudience = this.configService.get('VALIDATOR_AUTH_AUDIENCE') || 'https://validator.rhein.finance';
    this.auth0TokenUrl = this.configService.get('AUTH0_TOKEN_URL') || '';
    this.auth0ClientId = this.configService.get('AUTH0_CLIENT_ID') || '';
    this.auth0ClientSecret = this.configService.get('AUTH0_CLIENT_SECRET') || '';
    this.ledgerApiAuthAudience = this.configService.get('LEDGER_API_AUTH_AUDIENCE') || 'https://canton.network.global';
    this.usdcxAdminPartyId = this.configService.get('USDCX_ADMIN_PARTY_ID') || '';
    this.usdcxUtilityBackendUrl = this.configService.get('USDCX_UTILITY_BACKEND_URL') || 'https://api.utilities.digitalasset-staging.com';
    this.usdcxBridgeOperatorPartyId = this.configService.get('USDCX_BRIDGE_OPERATOR_PARTY_ID') || '';
    this.usdcxUtilityOperatorPartyId = this.configService.get('USDCX_UTILITY_OPERATOR_PARTY_ID') || '';
  }

  // ============================================================================
  // CORE HELPERS
  // ============================================================================

  private templateId(moduleName: string): string {
    return `${this.packageId}:${moduleName}`;
  }

  private amuletTemplateId(templateName: string): string {
    return `${this.amuletPackageId}:Splice.Amulet:${templateName}`;
  }

  /**
   * Get an Auth0 OAuth access token via client_credentials grant.
   * Tokens are cached until 60s before expiry.
   */
  private async getAuth0Token(audience: string): Promise<string> {
    const cached = this.tokenCache.get(audience);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.token;
    }

    const body = JSON.stringify({
      client_id: this.auth0ClientId,
      client_secret: this.auth0ClientSecret,
      audience,
      grant_type: 'client_credentials',
    });

    const response = await this.customFetch(this.auth0TokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Auth0 token request failed (${response.status}): ${errorText}`);
    }

    const data = await response.json();
    const token = data.access_token;
    // Cache with 60s margin before expiry
    const expiresAt = Date.now() + (data.expires_in - 60) * 1000;
    this.tokenCache.set(audience, { token, expiresAt });
    return token;
  }

  /**
   * Get an Auth0 token for the Validator Wallet API.
   */
  private async getValidatorToken(): Promise<string> {
    return this.getAuth0Token(this.validatorAuthAudience);
  }

  /**
   * Get an Auth0 token for the Ledger (JSON) API.
   */
  private async getLedgerApiToken(): Promise<string> {
    return this.getAuth0Token(this.ledgerApiAuthAudience);
  }

  /**
   * Register a DAML user with the validator and get a Canton party + wallet.
   * Uses the user's Auth0 token so the validator creates a party for that specific user.
   * Falls back to M2M admin token if no user token is provided.
   */
  async registerWithValidator(auth0IdOrToken: string, userToken?: string): Promise<string> {
    const token = userToken || await this.getValidatorToken();
    const url = `${this.validatorWalletUrl}/api/validator/v0/register`;
    const response = await this.customFetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: '{}',
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Validator register failed (${response.status}): ${errorText}`);
    }
    const result = await response.json();
    const partyId = result.party_id;
    if (!partyId) {
      throw new Error('Validator register did not return a party_id');
    }

    // Grant the administrator DAML user actAs rights for the new party
    // so it can submit commands on behalf of this party (e.g. loan operations)
    await this.grantAdminActAs(partyId);

    return partyId;
  }

  /**
   * Grant the administrator DAML user actAs rights for a party.
   */
  private async grantAdminActAs(partyId: string): Promise<void> {
    try {
      const token = await this.getLedgerApiToken();
      const response = await this.customFetch(
        `${this.jsonApiUrl}/v2/users/${this.damlUserId}/rights`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
          },
          body: JSON.stringify({
            userId: this.damlUserId,
            identityProviderId: '',
            rights: [{ kind: { CanActAs: { value: { party: partyId } } } }],
          }),
        },
      );
      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[DAML] Failed to grant actAs for ${partyId}: ${errorText}`);
      } else {
        console.log(`[DAML] Granted administrator actAs for ${partyId}`);
      }
    } catch (err) {
      console.error(`[DAML] Error granting actAs for ${partyId}:`, err);
    }
  }

  /**
   * Call the Validator Wallet API (runs inside Docker, has access to AmuletRules).
   */
  private async walletApiFetch(
    endpoint: string,
    method: string = 'GET',
    body?: any,
    userToken?: string,
  ): Promise<any> {
    // Use user's own Auth0 token if provided (for user-specific wallet operations),
    // otherwise fall back to M2M admin token
    const token = userToken || await this.getValidatorToken();
    const url = `${this.validatorWalletUrl}/api/validator/v0/wallet/${endpoint}`;
    const options: any = {
      method,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    };
    if (body) {
      options.body = JSON.stringify(body);
    }

    const response = await this.customFetch(url, options);
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Wallet API error (${response.status}): ${errorText}`);
    }
    const text = await response.text();
    if (!text || text.trim() === '') {
      return {};
    }
    return JSON.parse(text);
  }

  private async customFetch(url: string, options: any): Promise<any> {
    return new Promise((resolve, reject) => {
      const urlObj = new URL(url);
      const isHttps = urlObj.protocol === 'https:';
      const client = isHttps ? https : http;

      const requestOptions = {
        hostname: urlObj.hostname,
        port: urlObj.port || (isHttps ? 443 : 80),
        path: urlObj.pathname + urlObj.search,
        method: options.method || 'GET',
        headers: options.headers || {},
      };

      const req = client.request(requestOptions, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          resolve({
            ok: res.statusCode >= 200 && res.statusCode < 300,
            status: res.statusCode,
            statusText: res.statusMessage,
            headers: res.headers,
            text: async () => data,
            json: async () => JSON.parse(data),
          });
        });
      });

      req.on('error', (error) => reject(error));
      if (options.body) req.write(options.body);
      req.end();
    });
  }

  /**
   * Get the latest ledger offset for ACS queries.
   * Returns the current end offset so we see all active contracts.
   */
  private async getLatestOffset(): Promise<number> {
    const token = await this.getLedgerApiToken();
    const response = await this.customFetch(`${this.jsonApiUrl}/v2/state/ledger-end`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${token}` },
    });

    if (!response.ok) {
      // Fallback: use a very high offset
      console.warn('[DAML] Could not fetch ledger-end, using fallback offset');
      return 999999999;
    }

    const data = await response.json();
    return data.offset || 999999999;
  }

  /**
   * Query active contracts from the ledger.
   * Uses v2 API with userId auth (no JWT needed).
   *
   * Canton v2 JSON API format:
   * - filtersByParty with cumulative filters
   * - identifierFilter uses tagged union: {"TemplateFilter": {"value": {...}}}
   * - activeAtOffset must be a Long (current offset), not 0 or empty
   * - Response is a JSON array of contract entries
   */
  private async queryContracts(templateIds: string[], actAs: string[], readAs: string[] = []): Promise<any[]> {
    const offset = await this.getLatestOffset();

    // Build cumulative filter with each template
    const cumulativeFilters = templateIds.map(id => ({
      identifierFilter: {
        TemplateFilter: {
          value: { templateId: id, includeCreatedEventBlob: false },
        },
      },
      templateFilters: [],
    }));

    // Build per-party filter for all actAs parties
    const filtersByParty: Record<string, any> = {};
    for (const party of actAs) {
      filtersByParty[party] = { cumulative: cumulativeFilters };
    }

    const body = {
      userId: this.damlUserId,
      filter: { filtersByParty },
      activeAtOffset: offset,
    };

    console.log(`[DAML Query] templates=${templateIds.join(',')} actAs=${actAs.join(',')}`);

    const token = await this.getLedgerApiToken();
    const response = await this.customFetch(`${this.jsonApiUrl}/v2/state/active-contracts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[DAML Query Error] ${response.status}: ${errorText}`);
      throw new Error(`DAML Query Error (${response.status}): ${errorText}`);
    }

    // Response is a JSON array of contract entries
    const data = await response.json();
    const contracts: any[] = [];

    for (const entry of data) {
      // Canton v2 format: contractEntry.JsActiveContract.createdEvent
      const event =
        entry.contractEntry?.JsActiveContract?.createdEvent ||
        entry.contractEntry?.activeContract?.createdEvent ||
        entry.createdEvent ||
        entry;

      if (event?.contractId) {
        contracts.push({
          contractId: event.contractId,
          templateId: event.templateId,
          payload: event.createArgument || event.createArguments || event.payload,
        });
      }
    }

    console.log(`[DAML Query] Found ${contracts.length} contracts`);
    return contracts;
  }

  /**
   * List pending incoming USDCx TransferOffer contracts for a party (they are the receiver).
   * These are created by TransferFactory_Transfer and require the receiver to accept.
   */
  async getIncomingUSDCxTransfers(partyId: string): Promise<any[]> {
    const offset = await this.getLatestOffset();
    const token = await this.getLedgerApiToken();

    // Query using the TransferInstruction interface — the official way per DA utilities docs
    const TRANSFER_INSTRUCTION_INTERFACE = '55ba4deb0ad4662c4168b39859738a0e91388d252286480c7331b3f71a517281:Splice.Api.Token.TransferInstructionV1:TransferInstruction';

    const body = {
      userId: this.damlUserId,
      filter: {
        filtersByParty: {
          [partyId]: {
            cumulative: [{
              identifierFilter: {
                InterfaceFilter: {
                  value: {
                    interfaceId: TRANSFER_INSTRUCTION_INTERFACE,
                    includeInterfaceView: true,
                    includeCreatedEventBlob: false,
                  },
                },
              },
            }],
          },
        },
      },
      activeAtOffset: offset,
    };

    const response = await this.customFetch(`${this.jsonApiUrl}/v2/state/active-contracts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`ACS query failed (${response.status}): ${errText}`);
    }

    const data = await response.json();
    const transfers: any[] = [];

    for (const entry of data) {
      const event = entry.contractEntry?.JsActiveContract?.createdEvent || entry.createdEvent;
      if (!event?.contractId) continue;

      // Data comes from the interface view, not createArgument
      const view = event.interfaceViews?.[0]?.viewValue;
      if (!view) continue;

      const transfer = view.transfer;
      // Only include USDCx transfers where receiver = current user
      if (transfer?.receiver !== partyId) continue;
      if (transfer?.instrumentId?.id !== 'USDCx') continue;

      transfers.push({
        contractId: event.contractId,
        sender: transfer.sender,
        receiver: transfer.receiver,
        amount: transfer.amount,
        executeBefore: transfer.executeBefore,
        status: view.status?.tag || 'TransferPendingReceiverAcceptance',
      });
    }

    console.log(`[USDCx] Found ${transfers.length} pending incoming transfers for ${partyId}`);
    return transfers;
  }

  /**
   * Submit a command and wait for the transaction result.
   * Uses v2 API with userId auth (no JWT needed).
   *
   * Canton v2 JSON API format:
   * - commands wrapper with userId, commandId, actAs, readAs, and nested commands array
   */
  private async submitCommand(commands: any[], actAs: string[], readAs: string[] = []): Promise<any> {
    const commandId = `rhein-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const body = {
      commands: {
        userId: this.damlUserId,
        commandId,
        commands,
        actAs,
        readAs,
      },
    };

    console.log(`[DAML Command] actAs=${actAs.join(',')} commands=${commands.length}`);

    const token = await this.getLedgerApiToken();
    const response = await this.customFetch(
      `${this.jsonApiUrl}/v2/commands/submit-and-wait-for-transaction`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      },
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[DAML Command Error] ${response.status}: ${errorText}`);
      throw new Error(`DAML Command Error (${response.status}): ${errorText}`);
    }

    return response.json();
  }

  /** Build a CreateCommand */
  private createCmd(templateId: string, createArguments: any) {
    return { CreateCommand: { templateId, createArguments } };
  }

  /** Build an ExerciseCommand */
  private exerciseCmd(templateId: string, contractId: string, choice: string, choiceArgument: any) {
    return { ExerciseCommand: { templateId, contractId, choice, choiceArgument } };
  }

  /**
   * Extract the exercise result from a submit-and-wait response.
   * Events are wrapped in discriminators like CreatedEvent, ExercisedEvent.
   */
  private getExerciseResult(result: any): any {
    const events = result.transaction?.events || [];
    for (const event of events) {
      if (event.ExercisedEvent?.exerciseResult !== undefined) {
        return event.ExercisedEvent.exerciseResult;
      }
      // Fallback: unwrapped format
      if (event.exercised?.exerciseResult !== undefined) {
        return event.exercised.exerciseResult;
      }
    }
    return undefined;
  }

  /** Extract the first created contract ID from a submit-and-wait response */
  private getCreatedContractId(result: any): string | undefined {
    const events = result.transaction?.events || [];
    for (const event of events) {
      if (event.CreatedEvent?.contractId) return event.CreatedEvent.contractId;
      if (event.created?.contractId) return event.created.contractId;
    }
    return undefined;
  }

  // ============================================================================
  // CANTON COIN (AMULET) QUERIES
  // ============================================================================

  /**
   * Calculate effective CC balance from an Amulet's amount structure.
   * Amulet amounts accrue at ratePerRound; we use initialAmount as approximation.
   */
  private calculateAmuletAmount(amount: AmuletAmount): number {
    return parseFloat(amount.initialAmount);
  }

  async queryAmulets(partyId: string): Promise<Amulet[]> {
    return this.queryContracts(
      [this.amuletTemplateId('Amulet')],
      [partyId],
    );
  }

  async queryLockedAmulets(partyId: string): Promise<LockedAmulet[]> {
    return this.queryContracts(
      [this.amuletTemplateId('LockedAmulet')],
      [partyId],
    );
  }

  async getTokenBalances(partyId: string): Promise<{ usdcx: TokenBalance; cc: TokenBalance }> {
    // USDCx: from DA Utilities holdings
    const [usdcxBalance, amulets, lockedAmulets, activeLoans] = await Promise.all([
      this.getUSDCxBalance(partyId),
      this.queryAmulets(partyId),
      this.queryLockedAmulets(partyId),
      this.queryActiveLoans(partyId),
    ]);

    const usdcxBorrowed = activeLoans
      .filter((loan: ActiveLoan) => loan.payload.borrower === partyId)
      .reduce((sum, loan: ActiveLoan) => sum + parseFloat(loan.payload.principal), 0);

    const usdcxLent = activeLoans
      .filter((loan: ActiveLoan) => loan.payload.lender === partyId)
      .reduce((sum, loan: ActiveLoan) => sum + parseFloat(loan.payload.principal), 0);

    // CC: from real Canton Network Amulet contracts
    const ccAvailable = amulets.reduce(
      (sum, a) => sum + this.calculateAmuletAmount(a.payload.amount), 0,
    );

    const ccLocked = lockedAmulets.reduce(
      (sum, a) => sum + this.calculateAmuletAmount(a.payload.amulet.amount), 0,
    );

    return {
      usdcx: {
        assetType: 'USDCx',
        available: usdcxBalance.available,
        locked: usdcxBalance.locked,
        borrowed: usdcxBorrowed,
        lent: usdcxLent,
        total: usdcxBalance.available + usdcxLent,
      },
      cc: {
        assetType: 'CC',
        available: ccAvailable,
        locked: ccLocked,
        borrowed: 0,
        total: ccAvailable + ccLocked,
      },
    };
  }

  // ============================================================================
  // CANTON COIN (AMULET) OPERATIONS
  // ============================================================================

  /**
   * Lock real Canton Coins (Amulets) as collateral using the Validator Wallet API.
   *
   * Creates a TransferOffer via the wallet API, which holds the CC in escrow
   * on-chain until the offer is accepted (liquidation) or withdrawn (unlock).
   *
   * The wallet API internally exercises AmuletRules_Transfer (which our participant
   * can't do directly since AmuletRules is a DSO-internal contract).
   *
   * Returns the TransferOffer contract ID (used as the lock reference).
   */
  async lockAmulet(
    partyId: string,
    amount: number,
    lockHolder: string,
    expiresAt: string,
    userToken?: string,
  ): Promise<string> {
    // Verify sufficient CC balance first
    const amulets = await this.queryAmulets(partyId);
    if (amulets.length === 0) {
      throw new Error(`No Canton Coin (Amulet) holdings found for party ${partyId}`);
    }

    const totalCC = amulets.reduce((sum, a) => sum + this.calculateAmuletAmount(a.payload.amount), 0);
    if (totalCC < amount) {
      throw new Error(`Insufficient CC balance. Need ${amount}, have ${totalCC.toFixed(4)}`);
    }

    console.log(`[Amulet Lock] Creating TransferOffer for ${amount} CC (total balance: ${totalCC.toFixed(4)} CC)`);

    // Convert expiresAt to microseconds epoch for the wallet API
    const expiresAtMicros = new Date(expiresAt).getTime() * 1000;
    const trackingId = `collateral-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    // Create a TransferOffer via the Validator Wallet API
    // This locks the CC in an on-chain escrow (TransferOffer contract)
    const result = await this.walletApiFetch('transfer-offers', 'POST', {
      receiver_party_id: lockHolder,
      amount: amount.toString(),
      description: `Loan collateral: ${amount} CC locked until ${expiresAt}`,
      expires_at: expiresAtMicros,
      tracking_id: trackingId,
    }, userToken);

    const offerContractId = result.offer_contract_id;
    console.log(`[Amulet Lock] Created TransferOffer ${offerContractId} (tracking: ${trackingId})`);

    // Immediately accept the TransferOffer using admin M2M token so CC moves into admin escrow.
    // This prevents the borrower from withdrawing the collateral after the loan is created.
    console.log(`[Amulet Lock] Auto-accepting collateral into admin escrow...`);
    await this.walletApiFetch(`transfer-offers/${offerContractId}/accept`, 'POST', {});
    console.log(`[Amulet Lock] CC collateral is now held in admin escrow`);

    return offerContractId;
  }

  /**
   * Return CC collateral from admin escrow to a recipient (borrower on repay, lender on default).
   * Creates a new TransferOffer from admin → recipient and auto-accepts using their token.
   */
  async returnCCCollateral(recipientPartyId: string, amount: number, recipientUserToken?: string): Promise<void> {
    console.log(`[Amulet Return] Sending ${amount} CC from admin escrow to ${recipientPartyId}`);

    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24h window to accept
    const expiresAtMicros = expiresAt.getTime() * 1000;
    const trackingId = `collateral-return-${Date.now()}`;

    // Create TransferOffer from admin (no userToken = uses admin M2M wallet)
    const result = await this.walletApiFetch('transfer-offers', 'POST', {
      receiver_party_id: recipientPartyId,
      amount: amount.toString(),
      description: `Collateral return: ${amount} CC`,
      expires_at: expiresAtMicros,
      tracking_id: trackingId,
    });

    const offerContractId = result.offer_contract_id;
    console.log(`[Amulet Return] TransferOffer ${offerContractId} created, auto-accepting for recipient`);

    // Auto-accept on behalf of the recipient
    await this.walletApiFetch(`transfer-offers/${offerContractId}/accept`, 'POST', {}, recipientUserToken);
    console.log(`[Amulet Return] CC collateral successfully returned to ${recipientPartyId}`);
  }

  // ============================================================================
  // LOAN OFFER OPERATIONS (Hybrid Contracts)
  // ============================================================================

  async queryLoanOffers(partyId: string): Promise<LoanOffer[]> {
    return this.queryContracts(
      [this.templateId('LoanOfferHybrid:LoanOfferHybrid')],
      [partyId],
    );
  }

  async queryAllLoanOffers(): Promise<LoanOffer[]> {
    return this.queryContracts(
      [this.templateId('LoanOfferHybrid:LoanOfferHybrid')],
      [this.adminPartyId],
    );
  }

  async createLoanOffer(
    partyId: string,
    offer: {
      offerType: 'BorrowerBid' | 'LenderAsk';
      loanAmount: string;
      collateralAmount: string;
      interestRate: string;
      maturityDate: string;
    },
    userToken?: string,
  ): Promise<any> {
    const today = new Date().toISOString().split('T')[0];

    let lockedCCCollateral: string | null = null;

    if (offer.offerType === 'BorrowerBid') {
      // Borrower locks real CC (Amulet) as collateral via TransferOffer
      const expiresAt = new Date(offer.maturityDate + 'T23:59:59Z').toISOString();
      lockedCCCollateral = await this.lockAmulet(
        partyId,
        parseFloat(offer.collateralAmount),
        this.adminPartyId,
        expiresAt,
        userToken,
      );
    }
    // LenderAsk: no upfront locking needed — lender disburses USDCx off-chain after acceptance

    return this.submitCommand(
      [this.createCmd(this.templateId('LoanOfferHybrid:LoanOfferHybrid'), {
        provider: this.adminPartyId,
        initiator: partyId,
        counterparty: null,
        offerType: offer.offerType,
        lockedCCCollateral,
        loanAmount: offer.loanAmount,
        collateralAmount: offer.collateralAmount,
        interestRate: offer.interestRate,
        maturityDate: offer.maturityDate,
        ltvRatio: this.defaultLtv.toString(),
        ccPrice: this.ccPrice.toString(),
        createdAt: today,
        observers: [this.adminPartyId],
      })],
      [this.adminPartyId, partyId],
    );
  }

  async acceptLoanOffer(partyId: string, offerContractId: string, offer: LoanOffer, userToken?: string): Promise<any> {
    let acceptorCCReference: string | null = null;

    if (offer.payload.offerType === 'LenderAsk') {
      // Acceptor (borrower) provides CC collateral
      const expiresAt = new Date(offer.payload.maturityDate + 'T23:59:59Z').toISOString();
      acceptorCCReference = await this.lockAmulet(
        partyId,
        parseFloat(offer.payload.collateralAmount),
        this.adminPartyId,
        expiresAt,
        userToken,
      );
    }
    // BorrowerBid: lender (acceptor) provides no upfront lock — disburses USDCx off-chain below

    console.log(`Accepting offer ${offerContractId} as ${partyId} (initiator: ${offer.payload.initiator})`);
    const result = await this.submitCommand(
      [this.exerciseCmd(
        this.templateId('LoanOfferHybrid:LoanOfferHybrid'),
        offerContractId,
        'AcceptHybrid',
        { acceptor: partyId, acceptorCCReference },
      )],
      [this.adminPartyId, offer.payload.initiator, partyId],
    );

    // Disburse USDCx from lender to borrower immediately after loan creation
    let disbursementResult: any = null;
    let disbursementError: string | null = null;
    try {
      const loanAmount = parseFloat(offer.payload.loanAmount);
      let lenderPartyId: string;
      let borrowerPartyId: string;
      let senderToken: string | undefined;

      if (offer.payload.offerType === 'BorrowerBid') {
        // partyId = lender (acceptor), initiator = borrower
        lenderPartyId = partyId;
        borrowerPartyId = offer.payload.initiator;
        senderToken = userToken; // lender's own token
      } else {
        // LenderAsk: initiator = lender, partyId = borrower (acceptor)
        lenderPartyId = offer.payload.initiator;
        borrowerPartyId = partyId;
        senderToken = undefined; // use admin ledger token to act as lender
      }

      console.log(`[USDCx] Disbursing ${loanAmount} USDCx from lender ${lenderPartyId} to borrower ${borrowerPartyId}`);
      disbursementResult = await this.transferUSDCx(lenderPartyId, borrowerPartyId, loanAmount, senderToken);
      console.log(`[USDCx] Disbursement transfer instruction created successfully`);

      // Auto-accept the TransferOffer on behalf of the borrower
      if (disbursementResult?.transferOfferContractId) {
        try {
          await this.acceptUSDCxTransfer(disbursementResult.transferOfferContractId, borrowerPartyId);
        } catch (acceptErr: any) {
          console.error(`[USDCx] Auto-accept failed (borrower must accept manually): ${acceptErr?.message}`);
        }
      } else {
        console.warn(`[USDCx] No TransferOffer contract ID found in disbursement result — borrower must accept manually`);
      }
    } catch (err: any) {
      disbursementError = err?.message || String(err);
      console.error(`[USDCx] Failed to disburse USDCx after accepting offer: ${disbursementError}`);
    }

    return { ...result, disbursement: disbursementResult, disbursementError };
  }

  // ============================================================================
  // ACTIVE LOAN OPERATIONS (Hybrid Contracts)
  // ============================================================================

  async queryActiveLoans(partyId: string): Promise<ActiveLoan[]> {
    return this.queryContracts(
      [this.templateId('ActiveLoanHybrid:ActiveLoanHybrid')],
      [partyId],
    );
  }

  async repayLoan(partyId: string, loanContractId: string, repaymentAmount: number, userToken?: string): Promise<any> {
    const today = new Date().toISOString().split('T')[0];

    const loans = await this.queryActiveLoans(partyId);
    const loan = loans.find(l => l.contractId === loanContractId);

    if (!loan) {
      throw new Error(`Loan ${loanContractId} not found`);
    }

    const lender = loan.payload.lender;
    console.log(`Repaying loan ${loanContractId} - Borrower: ${partyId}, Lender: ${lender}, Amount: ${repaymentAmount} USDCx`);

    // Step 1: Transfer USDCx from borrower back to lender
    console.log(`[USDCx] Transferring ${repaymentAmount} USDCx from borrower ${partyId} to lender ${lender}`);
    const transferResult = await this.transferUSDCx(partyId, lender, repaymentAmount, userToken);
    console.log(`[USDCx] Repayment transfer created, auto-accepting on behalf of lender`);

    // Step 2: Auto-accept on behalf of the lender
    if (transferResult?.transferOfferContractId) {
      try {
        await this.acceptUSDCxTransfer(transferResult.transferOfferContractId, lender);
        console.log(`[USDCx] Lender accepted repayment transfer`);
      } catch (acceptErr: any) {
        console.error(`[USDCx] Auto-accept for lender failed: ${acceptErr?.message}`);
        throw new Error(`USDCx repayment transfer failed: ${acceptErr?.message}`);
      }
    }

    // Step 3: RepayHybrid requires provider, borrower, and lender to sign.
    const repayResult = await this.submitCommand(
      [this.exerciseCmd(
        this.templateId('ActiveLoanHybrid:ActiveLoanHybrid'),
        loanContractId,
        'RepayHybrid',
        { repaymentDate: today, repaymentAmount: repaymentAmount.toString() },
      )],
      [this.adminPartyId, partyId, lender],
    );

    // Return CC collateral from admin escrow back to the borrower
    const collateralAmount = parseFloat(loan.payload.collateralAmount || '0');
    if (collateralAmount > 0) {
      try {
        await this.returnCCCollateral(partyId, collateralAmount, userToken);
      } catch (unlockErr) {
        console.error(`[Amulet] Failed to return CC collateral: ${unlockErr}`);
        // Don't fail the whole repayment — DAML settlement succeeded
      }
    }

    return repayResult;
  }

  async defaultLoan(partyId: string, loanContractId: string, overrideClaimDate?: string, userToken?: string): Promise<any> {
    const today = new Date().toISOString().split('T')[0];

    const loans = await this.queryActiveLoans(partyId);
    const loan = loans.find(l => l.contractId === loanContractId);

    if (!loan) {
      throw new Error(`Loan ${loanContractId} not found`);
    }

    const claimDate = overrideClaimDate || today;

    // Check maturity
    if (claimDate < loan.payload.maturityDate) {
      throw new Error(`Loan has not matured yet. Maturity date: ${loan.payload.maturityDate}, claim date: ${claimDate}`);
    }

    const borrower = loan.payload.borrower;
    console.log(`Claiming default on loan ${loanContractId} - Lender: ${partyId}, Borrower: ${borrower}`);

    const defaultResult = await this.submitCommand(
      [this.exerciseCmd(
        this.templateId('ActiveLoanHybrid:ActiveLoanHybrid'),
        loanContractId,
        'ClaimDefaultHybrid',
        { claimDate },
      )],
      [this.adminPartyId, partyId, borrower],
    );

    // Send CC collateral from admin escrow to the lender as penalty
    const collateralAmount = parseFloat(loan.payload.collateralAmount || '0');
    if (collateralAmount > 0) {
      try {
        console.log(`[Amulet] Sending CC collateral to lender ${partyId} after default`);
        await this.returnCCCollateral(partyId, collateralAmount, userToken);
        console.log(`[Amulet] CC collateral successfully transferred to lender`);
      } catch (claimErr) {
        console.error(`[Amulet] Failed to claim CC collateral: ${claimErr}`);
      }
    }

    return defaultResult;
  }

  // ============================================================================
  // TRANSACTION EXPLORER
  // ============================================================================

  private async getLedgerEnd(): Promise<number> {
    const token = await this.getLedgerApiToken();
    const response = await this.customFetch(`${this.jsonApiUrl}/v2/state/ledger-end`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${token}` },
    });
    if (!response.ok) return 0;
    const data = await response.json();
    // Canton v2 returns { offset: number } or { ledgerEnd: { absolute: number } }
    return data?.offset ?? data?.ledgerEnd?.absolute ?? data?.ledgerEnd ?? 0;
  }

  async getTransactionStream(partyId: string, fromOffset?: string, limit = 100): Promise<Transaction[]> {
    // Use endInclusive to bound the query — Canton has a node-level 200-element cap
    // and rejects unbounded requests when the party has >200 transactions.
    const ledgerEnd = await this.getLedgerEnd();
    const endInclusive = ledgerEnd;
    const beginExclusive = fromOffset
      ? parseInt(fromOffset)
      : Math.max(0, ledgerEnd - limit);

    const body = {
      beginExclusive,
      endInclusive,
      filter: {
        filtersByParty: {
          [partyId]: {
            cumulative: [{
              identifierFilter: {
                WildcardFilter: { value: { includeCreatedEventBlob: false } },
              },
            }],
          },
        },
      },
      verbose: true,
    };

    const token = await this.getLedgerApiToken();
    const response = await this.customFetch(`${this.jsonApiUrl}/v2/updates/flats`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to fetch transactions: ${response.status} - ${errorText}`);
    }

    // Response may be JSON array or NDJSON
    const text = await response.text();
    const transactions: Transaction[] = [];

    let items: any[];
    try {
      const parsed = JSON.parse(text);
      items = Array.isArray(parsed) ? parsed : [parsed];
    } catch {
      // Try NDJSON
      items = text.split('\n')
        .filter(l => l.trim())
        .map(l => { try { return JSON.parse(l); } catch { return null; } })
        .filter(Boolean);
    }

    for (const obj of items) {
      const tx = obj.update?.Transaction?.value || obj.update?.transaction?.value || obj.update?.Transaction || obj.update?.transaction || obj.transaction || obj;
      if (!tx?.updateId && !tx?.transactionId) continue;

      transactions.push({
        transactionId: tx.updateId || tx.transactionId,
        effectiveAt: tx.effectiveAt,
        offset: String(tx.offset),
        events: (tx.events || []).map((e: any) => {
          const created = e.CreatedEvent || e.created;
          const exercised = e.ExercisedEvent || e.exercised;
          const archived = e.ArchivedEvent || e.archived;

          if (created) {
            return {
              eventType: 'created' as const,
              contractId: created.contractId,
              templateId: created.templateId,
              eventId: created.eventId || '',
              payload: created.createArgument || created.createArguments,
            };
          }
          if (exercised) {
            return {
              eventType: 'exercised' as const,
              contractId: exercised.contractId,
              templateId: exercised.templateId,
              eventId: exercised.eventId || '',
              choice: exercised.choice,
              argument: exercised.choiceArgument,
            };
          }
          if (archived) {
            return {
              eventType: 'archived' as const,
              contractId: archived.contractId,
              templateId: archived.templateId,
              eventId: archived.eventId || '',
            };
          }
          return {
            eventType: 'created' as const,
            contractId: e.contractId || '',
            templateId: e.templateId || '',
            eventId: e.eventId || '',
            payload: e.payload,
          };
        }),
      });
    }

    return transactions;
  }

  async getTransactionById(partyId: string, transactionId: string): Promise<Transaction | null> {
    const transactions = await this.getTransactionStream(partyId);
    return transactions.find(tx => tx.transactionId === transactionId) || null;
  }

  async getContractHistory(partyId: string, contractId: string): Promise<Transaction[]> {
    const transactions = await this.getTransactionStream(partyId);
    return transactions.filter(tx => tx.events.some(e => e.contractId === contractId));
  }

  // ============================================================================
  // WALLET OPERATIONS (Transfers)
  // ============================================================================

  /**
   * Transfer CC (Canton Coins) via token-standard transfer instruction.
   * Creates an AmuletTransferInstruction that the recipient must accept.
   */
  async transferCC(senderPartyId: string, recipientPartyId: string, amount: number, userToken?: string): Promise<any> {
    const amulets = await this.queryAmulets(senderPartyId);
    if (amulets.length === 0) {
      throw new Error(`No Canton Coin holdings found for party ${senderPartyId}`);
    }

    const totalCC = amulets.reduce((sum, a) => sum + this.calculateAmuletAmount(a.payload.amount), 0);
    if (totalCC < amount) {
      throw new Error(`Insufficient CC balance. Need ${amount}, have ${totalCC.toFixed(4)}`);
    }

    // 24 hour expiry
    const expiresAtMicros = (Date.now() + 24 * 60 * 60 * 1000) * 1000;
    const trackingId = `transfer-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    console.log(`[Transfer] Creating CC transfer instruction: ${amount} CC from ${senderPartyId} to ${recipientPartyId}`);
    const result = await this.walletApiFetch('token-standard/transfers', 'POST', {
      receiver_party_id: recipientPartyId,
      amount: amount.toString(),
      description: `Transfer: ${amount} CC`,
      expires_at: expiresAtMicros,
      tracking_id: trackingId,
    }, userToken);

    console.log(`[Transfer] CC transfer instruction created`);
    return {
      success: true,
      contractId: result.contract_id,
      amount,
      from: senderPartyId,
      to: recipientPartyId,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    };
  }

  /**
   * List CC transfers (incoming and outgoing) from the token-standard API.
   * Also includes legacy TransferOffer contracts.
   */
  async listTransfers(userToken?: string): Promise<any> {
    const [tokenStandard, transferOffers] = await Promise.all([
      this.walletApiFetch('token-standard/transfers', 'GET', undefined, userToken),
      this.walletApiFetch('transfer-offers', 'GET', undefined, userToken),
    ]);
    return {
      transfers: tokenStandard.transfers || [],
      offers: transferOffers.offers || [],
    };
  }

  /**
   * @deprecated Use listTransfers instead
   */
  async listTransferOffers(userToken?: string): Promise<any> {
    return this.listTransfers(userToken);
  }

  /**
   * Accept an incoming CC transfer. Must be called as the receiver's DAML user.
   * Tries token-standard first, falls back to transfer-offers.
   */
  async acceptTransfer(transferId: string, userToken?: string): Promise<any> {
    console.log(`[Transfer] Accepting CC transfer: ${transferId}`);
    try {
      const result = await this.walletApiFetch(`token-standard/transfers/${transferId}/accept`, 'POST', {}, userToken);
      console.log(`[Transfer] CC transfer accepted (token-standard)`);
      return result;
    } catch (err) {
      console.log(`[Transfer] token-standard accept failed, trying transfer-offers...`);
      const result = await this.walletApiFetch(`transfer-offers/${transferId}/accept`, 'POST', {}, userToken);
      console.log(`[Transfer] CC transfer accepted (transfer-offer)`);
      return result;
    }
  }

  /**
   * @deprecated Use acceptTransfer instead
   */
  async acceptTransferOffer(offerId: string, userToken?: string): Promise<any> {
    return this.acceptTransfer(offerId, userToken);
  }

  /**
   * Reject/withdraw a CC transfer. Tries token-standard first, falls back to transfer-offers.
   */
  async rejectTransfer(transferId: string, userToken?: string): Promise<any> {
    console.log(`[Transfer] Rejecting CC transfer: ${transferId}`);

    // 1. Receiver rejects a token-standard transfer instruction
    try {
      const result = await this.walletApiFetch(`token-standard/transfers/${transferId}/reject`, 'POST', {}, userToken);
      console.log(`[Transfer] CC transfer rejected (token-standard receiver reject)`);
      return result;
    } catch (err) {
      console.log(`[Transfer] token-standard reject failed (${(err as Error).message}), trying abort...`);
    }

    // 2. Sender withdraws a token-standard AmuletTransferInstruction
    try {
      const result = await this.walletApiFetch(`token-standard/transfers/${transferId}/withdraw`, 'POST', {}, userToken);
      console.log(`[Transfer] CC transfer withdrawn (token-standard sender withdraw)`);
      return result;
    } catch (err) {
      console.log(`[Transfer] token-standard withdraw failed (${(err as Error).message}), trying legacy withdraw...`);
    }

    // 3. Legacy TransferOffer withdraw
    const result = await this.walletApiFetch(`transfer-offers/${transferId}/withdraw`, 'POST', {}, userToken);
    console.log(`[Transfer] CC transfer withdrawn (legacy transfer-offer)`);
    return result;
  }

  /**
   * @deprecated Use rejectTransfer instead
   */
  async rejectTransferOffer(offerId: string, userToken?: string): Promise<any> {
    return this.rejectTransfer(offerId, userToken);
  }

  // ============================================================================
  // USDCx (Canton Universal Bridge - CIP-56 Token Standard)
  // ============================================================================

  /**
   * Get Burn Mint Factory context from the Canton Utilities API.
   * Cached for 1 hour since these values change infrequently.
   * Required for mint (deposit) and burn (withdrawal) operations.
   */
  async getUSDCxBurnMintContext(partyId: string): Promise<{
    factoryId: string;
    choiceContextData: any;
    disclosedContracts: any[];
  }> {
    if (this.usdcxContextCache && Date.now() - this.usdcxContextCache.cachedAt < 60 * 60 * 1000) {
      return this.usdcxContextCache;
    }

    const response = await this.customFetch(
      `${this.usdcxUtilityBackendUrl}/api/utilities/v0/registry/burn-mint-instruction/v0/burn-mint-factory`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          instrumentId: { admin: this.usdcxAdminPartyId, id: 'USDCx' },
          inputHoldingCids: [],
          outputs: [{ owner: partyId, amount: '0' }],
        }),
      },
    );

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`USDCx Burn Mint Factory API error (${response.status}): ${text}`);
    }

    const data = await response.json();
    // Response format: { factoryId, choiceContext: { choiceContextData, disclosedContracts } }
    const context = {
      factoryId: data.factoryId,
      choiceContextData: data.choiceContext?.choiceContextData,
      disclosedContracts: data.choiceContext?.disclosedContracts || [],
      cachedAt: Date.now(),
    };

    this.usdcxContextCache = context;
    return context;
  }

  /**
   * Query USDCx holdings for a party from the DAML ledger.
   * Uses the Utility.Registry.Holding.V0.Holding template from the CUB utilities DAR.
   */
  async getUSDCxHoldings(partyId: string): Promise<any[]> {
    const holdingTemplateId = 'dd3a9f2d51cc4c52d9ec2e1d7ff235298dcfb3afd1d50ab44328b1aaa9a18587:Utility.Registry.Holding.V0.Holding:Holding';
    try {
      const contracts = await this.queryContracts([holdingTemplateId], [partyId]);
      return contracts.filter(
        c =>
          c.payload?.instrument?.id === 'USDCx' &&
          c.payload?.owner === partyId,
      );
    } catch (err) {
      console.log(`[USDCx] Holdings query failed (${(err as Error).message}), returning empty`);
      return [];
    }
  }

  /**
   * Get USDCx balance for a party, separating locked (in-transit) from available.
   * Holdings with a lock field are pending transfer acceptance and cannot be spent.
   */
  async getUSDCxBalance(partyId: string): Promise<{ available: number; locked: number; total: number }> {
    const holdings = await this.getUSDCxHoldings(partyId);
    let available = 0;
    let locked = 0;
    for (const h of holdings) {
      const amount = parseFloat(h.payload?.amount || '0');
      if (h.payload?.lock) {
        locked += amount;
      } else {
        available += amount;
      }
    }
    return { available, locked, total: available + locked };
  }

  /**
   * Transfer USDCx to another party using the CUB token-standard transfer flow:
   *   1. Query sender's USDCx holding CIDs
   *   2. Call the utility backend transfer-factory endpoint to get factory context
   *   3. Submit DAML ExerciseCommand TransferFactory_Transfer with user's token
   */
  async transferUSDCx(senderPartyId: string, recipientPartyId: string, amount: number, userToken?: string): Promise<any> {
    console.log(`[USDCx] Transferring ${amount} USDCx: ${senderPartyId} → ${recipientPartyId}`);

    // Step 1: Get sender's holding CIDs
    const holdings = await this.getUSDCxHoldings(senderPartyId);
    const totalBalance = holdings.reduce((s, h) => s + parseFloat(h.payload?.amount || '0'), 0);
    if (totalBalance < amount) {
      throw new Error(`Insufficient USDCx balance. Need ${amount}, have ${totalBalance}`);
    }

    // Pick enough holdings to cover the amount
    let remaining = amount;
    const inputHoldingCids: string[] = [];
    for (const h of holdings) {
      if (remaining <= 0) break;
      inputHoldingCids.push(h.contractId);
      remaining -= parseFloat(h.payload?.amount || '0');
    }

    // Step 2: Call the utility backend transfer-factory endpoint
    const now = new Date();
    const threeDaysLater = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
    const fmt = (d: Date) => d.toISOString().replace(/\.\d+Z$/, 'Z');

    const factoryToken = userToken || await this.getLedgerApiToken();
    const factoryUrl = `${this.usdcxUtilityBackendUrl}/api/token-standard/v0/registrars/${encodeURIComponent(this.usdcxAdminPartyId)}/registry/transfer-instruction/v1/transfer-factory`;
    const factoryResponse = await this.customFetch(factoryUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${factoryToken}` },
      body: JSON.stringify({
        choiceArguments: {
          expectedAdmin: this.usdcxAdminPartyId,
          transfer: {
            sender: senderPartyId,
            receiver: recipientPartyId,
            amount: amount.toString(),
            instrumentId: { admin: this.usdcxAdminPartyId, id: 'USDCx' },
            requestedAt: fmt(now),
            executeBefore: fmt(threeDaysLater),
            inputHoldingCids,
            meta: { values: { 'splice.lfdecentralizedtrust.org/reason': '' } },
          },
          extraArgs: { context: { values: {} }, meta: { values: {} } },
        },
        excludeDebugFields: true,
      }),
    });

    if (!factoryResponse.ok) {
      const err = await factoryResponse.text();
      throw new Error(`USDCx transfer-factory error (${factoryResponse.status}): ${err}`);
    }
    const factoryData = await factoryResponse.json();
    const factoryId = factoryData.factoryId;
    const choiceContextData = factoryData.choiceContext?.choiceContextData;
    const disclosedContracts = factoryData.choiceContext?.disclosedContracts || [];

    // Step 3: Submit DAML command with operator token
    const transferFactoryInterface = '#splice-api-token-transfer-instruction-v1:Splice.Api.Token.TransferInstructionV1:TransferFactory';
    const commandId = `rhein-usdcx-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const token = await this.getLedgerApiToken();

    // Normalize disclosed contracts to only fields the participant accepts
    const normalizedDisclosedContracts = disclosedContracts.map((dc: any) => ({
      contractId: dc.contractId,
      templateId: dc.templateId,
      createdEventBlob: dc.createdEventBlob,
      domainId: '',
      synchronizerId: '',
    }));

    const commandBody = {
      commands: {
        userId: this.damlUserId,
        commandId,
        workflowId: '',
        commands: [{
          ExerciseCommand: {
            templateId: transferFactoryInterface,
            contractId: factoryId,
            choice: 'TransferFactory_Transfer',
            choiceArgument: {
              expectedAdmin: this.usdcxAdminPartyId,
              transfer: {
                sender: senderPartyId,
                receiver: recipientPartyId,
                amount: amount.toString(),
                instrumentId: { admin: this.usdcxAdminPartyId, id: 'USDCx' },
                requestedAt: fmt(now),
                executeBefore: fmt(threeDaysLater),
                inputHoldingCids,
                meta: { values: { 'splice.lfdecentralizedtrust.org/reason': '' } },
              },
              extraArgs: { context: choiceContextData, meta: { values: {} } },
            },
          },
        }],
        actAs: [senderPartyId],
        readAs: [],
        disclosedContracts: normalizedDisclosedContracts,
        domainId: '',
        packageIdSelectionPreference: [],
      },
    };

    console.log(`[USDCx] Submitting TransferFactory_Transfer command`);
    const cmdResponse = await this.customFetch(
      `${this.jsonApiUrl}/v2/commands/submit-and-wait-for-transaction`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify(commandBody),
      },
    );

    if (!cmdResponse.ok) {
      const err = await cmdResponse.text();
      console.error(`[USDCx] Transfer command error: ${err}`);
      throw new Error(`USDCx transfer failed (${cmdResponse.status}): ${err}`);
    }

    const cmdResult = await cmdResponse.json();
    console.log(`[USDCx] Transfer instruction created`);

    // Extract the TransferOffer contract ID from the transaction events
    const events = cmdResult.transaction?.events || [];
    let transferOfferContractId: string | undefined;
    for (const event of events) {
      const created = event.CreatedEvent || event.created;
      if (created?.contractId && created?.templateId?.includes('Transfer:TransferOffer')) {
        transferOfferContractId = created.contractId;
        break;
      }
    }

    return {
      success: true,
      amount,
      from: senderPartyId,
      to: recipientPartyId,
      expiresAt: threeDaysLater.toISOString(),
      updateId: cmdResult.transaction?.updateId,
      transferOfferContractId,
    };
  }

  /**
   * Auto-accept a pending USDCx TransferInstruction on behalf of the receiver.
   * Step 1: Fetch choice context from DA utilities backend.
   * Step 2: Submit TransferInstruction_Accept via the interface with actAs: [receiverPartyId].
   */
  async acceptUSDCxTransfer(transferInstructionCid: string, receiverPartyId: string, userToken?: string): Promise<void> {
    console.log(`[USDCx] Accepting TransferInstruction ${transferInstructionCid} for receiver ${receiverPartyId}`);

    // Step 1: Get choice context from DA utilities backend
    const token = userToken || await this.getLedgerApiToken();
    const contextUrl = `${this.usdcxUtilityBackendUrl}/api/token-standard/v0/registrars/${encodeURIComponent(this.usdcxAdminPartyId)}/registry/transfer-instruction/v1/${transferInstructionCid}/choice-contexts/accept`;

    console.log(`[USDCx] Fetching accept choice context from: ${contextUrl}`);
    const contextResponse = await this.customFetch(contextUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({}),
    });

    if (!contextResponse.ok) {
      const err = await contextResponse.text();
      throw new Error(`USDCx accept choice-context failed (${contextResponse.status}): ${err}`);
    }

    const contextData = await contextResponse.json();
    console.log(`[USDCx] Got accept choice context`);
    const choiceContextData = contextData.choiceContextData;
    const disclosedContracts = contextData.disclosedContracts || [];

    // Step 2: Submit TransferInstruction_Accept via the interface
    const commandId = `rhein-usdcx-accept-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const acceptBody = {
      commands: {
        userId: this.damlUserId,
        commandId,
        workflowId: '',
        commands: [{
          ExerciseCommand: {
            templateId: '#splice-api-token-transfer-instruction-v1:Splice.Api.Token.TransferInstructionV1:TransferInstruction',
            contractId: transferInstructionCid,
            choice: 'TransferInstruction_Accept',
            choiceArgument: {
              extraArgs: {
                context: choiceContextData,
                meta: { values: {} },
              },
            },
          },
        }],
        actAs: [receiverPartyId],
        readAs: [],
        disclosedContracts,
        domainId: '',
        packageIdSelectionPreference: [],
      },
    };

    // Always use admin ledger token for command submission — user JWT sub doesn't match Canton ledger user ID
    const submitToken = await this.getLedgerApiToken();
    const acceptResponse = await this.customFetch(
      `${this.jsonApiUrl}/v2/commands/submit-and-wait-for-transaction`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${submitToken}` },
        body: JSON.stringify(acceptBody),
      },
    );

    if (!acceptResponse.ok) {
      const err = await acceptResponse.text();
      throw new Error(`USDCx TransferInstruction_Accept failed (${acceptResponse.status}): ${err}`);
    }

    console.log(`[USDCx] TransferInstruction accepted — USDCx now in receiver's balance`);
  }
}
