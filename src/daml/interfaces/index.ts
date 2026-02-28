// DAML Contract Interfaces - Hybrid Contracts for Canton Network Testnet

// ============================================================================
// Canton Network Amulet (Real Canton Coin) Interfaces
// ============================================================================

export interface AmuletAmount {
  initialAmount: string;
  createdAt: { number: string };
  ratePerRound: { rate: string };
}

export interface Amulet {
  contractId: string;
  payload: {
    dso: string;
    owner: string;
    amount: AmuletAmount;
  };
}

export interface LockedAmulet {
  contractId: string;
  payload: {
    amulet: { dso: string; owner: string; amount: AmuletAmount };
    lock: { holders: string[]; expiresAt: string };
  };
}

// ============================================================================
// Custom Token Interfaces (USDC)
// ============================================================================

export interface AssetHolding {
  contractId: string;
  payload: {
    issuer: string;
    owner: string;
    custodian: string;
    assetType: string;
    amount: string;
  };
}

export interface LockedAssetHolding {
  contractId: string;
  payload: {
    issuer: string;
    owner: string;
    custodian: string;
    assetType: string;
    amount: string;
    lockReason: string;
    releaseTo: string;
  };
}

export interface LoanOfferHybrid {
  contractId: string;
  payload: {
    initiator: string;
    counterparty: string | null;
    offerType: 'BorrowerBid' | 'LenderAsk';
    lockedCCCollateral: string | null;
    lockedUSDCPrincipal: string | null;
    loanAmount: string;
    collateralAmount: string;
    interestRate: string;
    maturityDate: string;
    ltvRatio: string;
    ccPrice: string;
    stablecoinType: string;
    createdAt: string;
    observers: string[];
  };
}

export interface ActiveLoanHybrid {
  contractId: string;
  payload: {
    borrower: string;
    lender: string;
    ccCollateralReference: string;
    principal: string;
    collateralAmount: string;
    interestRate: string;
    maturityDate: string;
    originationDate: string;
    ccPrice: string;
    stablecoinType: string;
  };
}

export interface TokenBalance {
  assetType: string;
  available: number;
  locked: number;
  borrowed: number;
  total: number;
}

export interface Transaction {
  transactionId: string;
  effectiveAt: string;
  offset: string;
  workflowId?: string;
  commandId?: string;
  events: TransactionEvent[];
}

export interface TransactionEvent {
  eventType: 'created' | 'archived' | 'exercised';
  contractId: string;
  templateId: string;
  eventId: string;
  payload?: any;
  choice?: string;
  argument?: any;
}

// Aliases for backward compatibility with existing service references
export type LoanOffer = LoanOfferHybrid;
export type ActiveLoan = ActiveLoanHybrid;
