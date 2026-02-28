import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as http from 'http';
import * as https from 'https';
import {
  AssetHolding,
  LockedAssetHolding,
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

  // Cached Auth0 tokens (keyed by audience)
  private tokenCache: Map<string, { token: string; expiresAt: number }> = new Map();

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
  // TOKEN BALANCE QUERIES
  // ============================================================================

  async queryAssetHoldings(partyId: string): Promise<AssetHolding[]> {
    return this.queryContracts(
      [this.templateId('Holding:AssetHolding')],
      [partyId],
    );
  }

  async queryLockedAssetHoldings(partyId: string): Promise<LockedAssetHolding[]> {
    return this.queryContracts(
      [this.templateId('Holding:LockedAssetHolding')],
      [partyId],
    );
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

  async getTokenBalances(partyId: string): Promise<{ usdc: TokenBalance; cc: TokenBalance }> {
    // USDC: from custom AssetHolding contracts
    const holdings = await this.queryAssetHoldings(partyId);
    const lockedHoldings = await this.queryLockedAssetHoldings(partyId);
    const activeLoans = await this.queryActiveLoans(partyId);

    const usdcAvailable = holdings
      .filter(h => h.payload.assetType === 'USDC' && h.payload.owner === partyId)
      .reduce((sum, h) => sum + parseFloat(h.payload.amount), 0);

    const usdcLocked = lockedHoldings
      .filter(h => h.payload.assetType === 'USDC' && h.payload.owner === partyId)
      .reduce((sum, h) => sum + parseFloat(h.payload.amount), 0);

    const usdcBorrowed = activeLoans
      .filter((loan: ActiveLoan) => loan.payload.borrower === partyId)
      .reduce((sum, loan: ActiveLoan) => sum + parseFloat(loan.payload.principal), 0);

    // CC: from real Canton Network Amulet contracts
    const amulets = await this.queryAmulets(partyId);
    const lockedAmulets = await this.queryLockedAmulets(partyId);

    const ccAvailable = amulets.reduce(
      (sum, a) => sum + this.calculateAmuletAmount(a.payload.amount), 0,
    );

    const ccLocked = lockedAmulets.reduce(
      (sum, a) => sum + this.calculateAmuletAmount(a.payload.amulet.amount), 0,
    );

    return {
      usdc: {
        assetType: 'USDC',
        available: usdcAvailable,
        locked: usdcLocked,
        borrowed: usdcBorrowed,
        total: usdcAvailable + usdcLocked,
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
  // TOKEN OPERATIONS (USDC - Custom AssetHolding)
  // ============================================================================

  async lockUSDC(
    partyId: string,
    amount: number,
    lockReason: string,
    releaseTo: string,
  ): Promise<string> {
    const holdings = await this.queryAssetHoldings(partyId);
    const usdcHoldings = holdings.filter(
      h => h.payload.assetType === 'USDC' && h.payload.owner === partyId,
    );

    if (usdcHoldings.length === 0) {
      throw new Error(`No USDC holdings found for party ${partyId}`);
    }

    let holdingToLock: AssetHolding | null = null;

    const exactMatch = usdcHoldings.find(h => parseFloat(h.payload.amount) === amount);
    if (exactMatch) {
      holdingToLock = exactMatch;
    } else {
      const largeEnough = usdcHoldings.find(h => parseFloat(h.payload.amount) >= amount);
      if (!largeEnough) {
        const totalAvailable = usdcHoldings.reduce((sum, h) => sum + parseFloat(h.payload.amount), 0);
        throw new Error(`Insufficient USDC balance. Need ${amount}, have ${totalAvailable}`);
      }

      console.log(`Splitting USDC holding ${largeEnough.contractId} - need ${amount}, have ${largeEnough.payload.amount}`);
      const splitResult = await this.submitCommand(
        [this.exerciseCmd(
          this.templateId('Holding:AssetHolding'),
          largeEnough.contractId,
          'Split',
          { splitAmount: amount.toString() },
        )],
        [partyId],
      );

      const exerciseResult = this.getExerciseResult(splitResult);
      // Split returns a tuple (ContractId, ContractId) - try various formats
      const splitAmountCid = exerciseResult?._1
        || (Array.isArray(exerciseResult) ? exerciseResult[0] : undefined)
        || (typeof exerciseResult === 'string' ? exerciseResult : undefined);

      if (splitAmountCid) {
        holdingToLock = {
          contractId: splitAmountCid,
          payload: { ...largeEnough.payload, amount: amount.toString() },
        };
      } else {
        // Fallback: get the first created contract from events
        const events = splitResult.transaction?.events || [];
        const createdEvents = events
          .map((e: any) => e.CreatedEvent || e.created)
          .filter((e: any) => e?.contractId);

        if (createdEvents.length > 0) {
          // First created event is the split amount, second is the remainder
          console.log(`Split created ${createdEvents.length} contracts, using first as split amount`);
          holdingToLock = {
            contractId: createdEvents[0].contractId,
            payload: { ...largeEnough.payload, amount: amount.toString() },
          };
        } else {
          console.error('Split result structure:', JSON.stringify(splitResult, null, 2).substring(0, 2000));
          throw new Error('Split did not return expected contract IDs');
        }
      }
    }

    console.log(`Locking USDC holding ${holdingToLock.contractId} for ${amount}`);
    const lockResult = await this.submitCommand(
      [this.exerciseCmd(
        this.templateId('Holding:AssetHolding'),
        holdingToLock.contractId,
        'Lock',
        { lockReason, releaseTo },
      )],
      [partyId],
    );

    let lockedCid = this.getExerciseResult(lockResult);
    if (!lockedCid || typeof lockedCid !== 'string') {
      // Fallback: find the created LockedAssetHolding contract
      lockedCid = this.getCreatedContractId(lockResult);
    }
    if (!lockedCid) {
      console.error('Lock result structure:', JSON.stringify(lockResult, null, 2).substring(0, 2000));
      throw new Error('Lock did not return expected contract ID');
    }

    console.log(`Successfully locked ${amount} USDC -> ${lockedCid}`);
    return lockedCid;
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
    return offerContractId;
  }

  /**
   * Unlock CC collateral by withdrawing the TransferOffer (e.g., after loan repayment).
   * This returns the CC back to the original sender.
   */
  async unlockAmulet(transferOfferCid: string, _partyId: string, userToken?: string): Promise<string> {
    console.log(`[Amulet Unlock] Withdrawing TransferOffer ${transferOfferCid}`);

    await this.walletApiFetch(`transfer-offers/${transferOfferCid}/withdraw`, 'POST', {}, userToken);

    console.log(`[Amulet Unlock] Successfully withdrew TransferOffer - CC returned to sender`);
    return transferOfferCid;
  }

  // ============================================================================
  // FAUCET OPERATIONS (Token Initialization)
  // ============================================================================

  async initializeAssetIssuers(): Promise<string> {
    try {
      const issuers = await this.queryContracts(
        [this.templateId('Holding:AssetIssuer')],
        [this.adminPartyId],
      );

      if (issuers.length > 0) {
        console.log('Found existing issuer:', issuers[0].contractId);
        return issuers[0].contractId;
      }
    } catch (err) {
      console.log('Issuer not found, creating new one...');
    }

    const result = await this.submitCommand(
      [this.createCmd(this.templateId('Holding:AssetIssuer'), {
        issuer: this.adminPartyId,
        custodian: this.adminPartyId,
      })],
      [this.adminPartyId],
    );

    const contractId = this.getCreatedContractId(result);
    console.log('Created new issuer:', contractId);
    return contractId;
  }

  async issueTokensToParty(
    partyId: string,
    amount?: number,
  ): Promise<{ success: boolean; message: string }> {
    try {
      const issuerContractId = await this.initializeAssetIssuers();
      const usdcAmount = amount || 100000;

      await this.submitCommand(
        [this.exerciseCmd(
          this.templateId('Holding:AssetIssuer'),
          issuerContractId,
          'IssueAsset',
          { owner: partyId, assetType: 'USDC', amount: usdcAmount.toString() },
        )],
        [this.adminPartyId, partyId],
      );

      return { success: true, message: `Successfully issued ${usdcAmount} USDC (CC comes from real Canton Coins)` };
    } catch (err) {
      console.error('Error issuing USDC:', err);
      return {
        success: false,
        message: err instanceof Error ? err.message : 'Failed to issue USDC',
      };
    }
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
    let lockedUSDCPrincipal: string | null = null;

    if (offer.offerType === 'BorrowerBid') {
      // Borrower locks real CC (Amulet) as collateral
      const expiresAt = new Date(offer.maturityDate + 'T23:59:59Z').toISOString();
      const lockedCid = await this.lockAmulet(
        partyId,
        parseFloat(offer.collateralAmount),
        this.adminPartyId,
        expiresAt,
        userToken,
      );
      lockedCCCollateral = lockedCid;
    } else {
      // Lender locks USDC principal
      // releaseTo = initiator (self-lock) so that AcceptHybrid and CancelOfferHybrid
      // can exercise Unlock without needing the admin in the authorization context
      const lockedCid = await this.lockUSDC(
        partyId,
        parseFloat(offer.loanAmount),
        `LenderAsk for ${offer.loanAmount} USDC loan`,
        partyId,
      );
      lockedUSDCPrincipal = lockedCid;
    }

    return this.submitCommand(
      [this.createCmd(this.templateId('LoanOfferHybrid:LoanOfferHybrid'), {
        initiator: partyId,
        counterparty: null,
        offerType: offer.offerType,
        lockedCCCollateral,
        lockedUSDCPrincipal,
        loanAmount: offer.loanAmount,
        collateralAmount: offer.collateralAmount,
        interestRate: offer.interestRate,
        maturityDate: offer.maturityDate,
        ltvRatio: this.defaultLtv.toString(),
        ccPrice: this.ccPrice.toString(),
        stablecoinType: 'USDC',
        createdAt: today,
        observers: [this.adminPartyId],
      })],
      [partyId],
    );
  }

  async acceptLoanOffer(partyId: string, offerContractId: string, offer: LoanOffer, userToken?: string): Promise<any> {
    let acceptorUSDCCid: string | null = null;
    let acceptorCCReference: string | null = null;

    if (offer.payload.offerType === 'BorrowerBid') {
      // Acceptor (lender) provides USDC
      const lockedCid = await this.lockUSDC(
        partyId,
        parseFloat(offer.payload.loanAmount),
        `Accepting offer ${offerContractId}`,
        offer.payload.initiator,
      );
      acceptorUSDCCid = lockedCid;
    } else {
      // Acceptor (borrower) provides real CC (Amulet)
      const expiresAt = new Date(offer.payload.maturityDate + 'T23:59:59Z').toISOString();
      const lockedCid = await this.lockAmulet(
        partyId,
        parseFloat(offer.payload.collateralAmount),
        this.adminPartyId,
        expiresAt,
        userToken,
      );
      acceptorCCReference = lockedCid;
    }

    console.log(`Accepting offer ${offerContractId} as ${partyId} (initiator: ${offer.payload.initiator})`);
    return this.submitCommand(
      [this.exerciseCmd(
        this.templateId('LoanOfferHybrid:LoanOfferHybrid'),
        offerContractId,
        'AcceptHybrid',
        { acceptor: partyId, acceptorUSDCCid, acceptorCCReference },
      )],
      [offer.payload.initiator, partyId, this.adminPartyId],
    );
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
    console.log(`Repaying loan ${loanContractId} - Borrower: ${partyId}, Lender: ${lender}`);

    // Find or split a USDC holding for repayment
    const holdings = await this.queryAssetHoldings(partyId);
    const usdcHoldings = holdings.filter(
      h => h.payload.assetType === 'USDC' && h.payload.owner === partyId,
    );

    if (usdcHoldings.length === 0) {
      throw new Error('No USDC holdings found for repayment');
    }

    let repaymentHoldingCid: string;
    const exactMatch = usdcHoldings.find(h => Math.abs(parseFloat(h.payload.amount) - repaymentAmount) < 0.01);

    if (exactMatch) {
      repaymentHoldingCid = exactMatch.contractId;
    } else {
      const largeEnough = usdcHoldings.find(h => parseFloat(h.payload.amount) >= repaymentAmount);
      if (!largeEnough) {
        const totalAvailable = usdcHoldings.reduce((sum, h) => sum + parseFloat(h.payload.amount), 0);
        throw new Error(`Insufficient USDC for repayment. Need ${repaymentAmount}, have ${totalAvailable}`);
      }

      const splitResult = await this.submitCommand(
        [this.exerciseCmd(
          this.templateId('Holding:AssetHolding'),
          largeEnough.contractId,
          'Split',
          { splitAmount: repaymentAmount.toString() },
        )],
        [partyId],
      );

      const exerciseResult = this.getExerciseResult(splitResult);
      repaymentHoldingCid = exerciseResult?._1
        || (Array.isArray(exerciseResult) ? exerciseResult[0] : undefined)
        || (typeof exerciseResult === 'string' ? exerciseResult : undefined);

      if (!repaymentHoldingCid) {
        // Fallback: get first created contract from events
        repaymentHoldingCid = this.getCreatedContractId(splitResult);
      }
      if (!repaymentHoldingCid) {
        console.error('Split result for repayment:', JSON.stringify(splitResult, null, 2).substring(0, 2000));
        throw new Error('Failed to split holdings for repayment');
      }
    }

    console.log(`Repaying with holding ${repaymentHoldingCid} amount ${repaymentAmount}`);
    const repayResult = await this.submitCommand(
      [this.exerciseCmd(
        this.templateId('ActiveLoanHybrid:ActiveLoanHybrid'),
        loanContractId,
        'RepayHybrid',
        { repaymentDate: today, repaymentHoldingCid },
      )],
      [partyId, lender],
    );

    // RepayHybrid returns (ContractId SettledLoan, Text) where Text is the ccCollateralReference
    // Unlock the real Amulet collateral back to the borrower
    const ccCollateralRef = loan.payload.ccCollateralReference;
    if (ccCollateralRef) {
      try {
        console.log(`[Amulet] Unlocking CC collateral ${ccCollateralRef} back to borrower ${partyId}`);
        await this.unlockAmulet(ccCollateralRef, partyId, userToken);
        console.log(`[Amulet] Successfully unlocked CC collateral after repayment`);
      } catch (unlockErr) {
        console.error(`[Amulet] Failed to unlock CC collateral: ${unlockErr}`);
        // Don't fail the whole repayment - the DAML repayment succeeded
        // The unlock can be retried manually
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
      [partyId, borrower],
    );

    // Claim the CC collateral (accept the TransferOffer)
    const ccCollateralRef = loan.payload.ccCollateralReference;
    if (ccCollateralRef) {
      try {
        console.log(`[Amulet] Claiming CC collateral ${ccCollateralRef} for lender ${partyId}`);
        // Accept the transfer offer to claim the CC
        await this.walletApiFetch(`transfer-offers/${ccCollateralRef}/accept`, 'POST', {}, userToken);
        console.log(`[Amulet] Successfully claimed CC collateral after default`);
      } catch (claimErr) {
        console.error(`[Amulet] Failed to claim CC collateral: ${claimErr}`);
      }
    }

    return defaultResult;
  }

  // ============================================================================
  // TRANSACTION EXPLORER
  // ============================================================================

  async getTransactionStream(partyId: string, fromOffset?: string): Promise<Transaction[]> {
    const body = {
      beginExclusive: fromOffset ? parseInt(fromOffset) : 0,
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

    return transactions.slice(0, 50);
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
  // WALLET OPERATIONS (Direct Transfers)
  // ============================================================================

  /**
   * Transfer USDC directly from one party to another.
   * Finds a holding with sufficient balance, splits if needed, then exercises Transfer.
   */
  async transferUSDC(senderPartyId: string, recipientPartyId: string, amount: number): Promise<any> {
    const holdings = await this.queryAssetHoldings(senderPartyId);
    const usdcHoldings = holdings.filter(
      h => h.payload.assetType === 'USDC' && h.payload.owner === senderPartyId,
    );

    if (usdcHoldings.length === 0) {
      throw new Error(`No USDC holdings found for party ${senderPartyId}`);
    }

    let holdingToTransfer: AssetHolding | null = null;

    const exactMatch = usdcHoldings.find(h => parseFloat(h.payload.amount) === amount);
    if (exactMatch) {
      holdingToTransfer = exactMatch;
    } else {
      const largeEnough = usdcHoldings.find(h => parseFloat(h.payload.amount) >= amount);
      if (!largeEnough) {
        const totalAvailable = usdcHoldings.reduce((sum, h) => sum + parseFloat(h.payload.amount), 0);
        throw new Error(`Insufficient USDC balance. Need ${amount}, have ${totalAvailable}`);
      }

      // Split the holding to get exact amount
      console.log(`[Transfer] Splitting USDC holding - need ${amount}, have ${largeEnough.payload.amount}`);
      const splitResult = await this.submitCommand(
        [this.exerciseCmd(
          this.templateId('Holding:AssetHolding'),
          largeEnough.contractId,
          'Split',
          { splitAmount: amount.toString() },
        )],
        [senderPartyId],
      );

      const exerciseResult = this.getExerciseResult(splitResult);
      const splitAmountCid = exerciseResult?._1
        || (Array.isArray(exerciseResult) ? exerciseResult[0] : undefined)
        || (typeof exerciseResult === 'string' ? exerciseResult : undefined);

      if (splitAmountCid) {
        holdingToTransfer = {
          contractId: splitAmountCid,
          payload: { ...largeEnough.payload, amount: amount.toString() },
        };
      } else {
        const events = splitResult.transaction?.events || [];
        const createdEvents = events
          .map((e: any) => e.CreatedEvent || e.created)
          .filter((e: any) => e?.contractId);
        if (createdEvents.length > 0) {
          holdingToTransfer = {
            contractId: createdEvents[0].contractId,
            payload: { ...largeEnough.payload, amount: amount.toString() },
          };
        } else {
          throw new Error('Split did not return expected contract IDs');
        }
      }
    }

    // Exercise Transfer choice
    console.log(`[Transfer] Transferring ${amount} USDC from ${senderPartyId} to ${recipientPartyId}`);
    const transferResult = await this.submitCommand(
      [this.exerciseCmd(
        this.templateId('Holding:AssetHolding'),
        holdingToTransfer.contractId,
        'Transfer',
        { newOwner: recipientPartyId },
      )],
      [senderPartyId, recipientPartyId],
    );

    console.log(`[Transfer] Successfully transferred ${amount} USDC`);
    return {
      success: true,
      amount,
      from: senderPartyId,
      to: recipientPartyId,
      transactionId: transferResult.transaction?.transactionId,
    };
  }

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
    try {
      const result = await this.walletApiFetch(`token-standard/transfers/${transferId}/reject`, 'POST', {}, userToken);
      console.log(`[Transfer] CC transfer rejected (token-standard)`);
      return result;
    } catch (err) {
      console.log(`[Transfer] token-standard reject failed, trying transfer-offers withdraw...`);
      const result = await this.walletApiFetch(`transfer-offers/${transferId}/withdraw`, 'POST', {}, userToken);
      console.log(`[Transfer] CC transfer rejected (transfer-offer)`);
      return result;
    }
  }

  /**
   * @deprecated Use rejectTransfer instead
   */
  async rejectTransferOffer(offerId: string, userToken?: string): Promise<any> {
    return this.rejectTransfer(offerId, userToken);
  }
}
