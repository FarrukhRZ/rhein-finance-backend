# Rhein Finance — DAML Smart Contracts

DAML contracts for the Rhein Finance P2P lending protocol, deployed on the Canton Network (Global Synchronizer / Testnet).

---

## Overview

The contracts implement a **hybrid collateral lending protocol**:

- **Collateral**: Canton Coin (CC / Amulet) — locked on-chain via the Canton Validator Wallet API.
- **Principal**: USDCx (Canton Universal Bridge stablecoin) — transferred off-chain via the DA token-standard API.
- **Settlement**: All loan lifecycle events (offer creation, acceptance, repayment, default) are enforced by DAML contracts requiring multi-party authorization.
- **Rewards**: Every key lifecycle event generates a CIP-0104 app reward marker via `FeaturedAppRight_CreateActivityMarker`.

---

## Build Info

| Field | Value |
|-------|-------|
| DAML SDK | 3.4.9 |
| Package name | `rhein-lending-v2` |
| Package version | `0.5.0` |
| Target LF version | `2.1` |
| Data dependency | `splice-api-featured-app-v1-1.0.0.dar` |

---

## Contract Structure

```
rhein-contracts/
└── daml/
    ├── Types.daml           — Shared data types (OfferType, LoanTerms, LoanStatus, SettlementOutcome)
    ├── Utils.daml           — Pure business logic functions (interest calc, validation, LTV)
    ├── LoanOfferHybrid.daml — Loan offer template (pre-loan state)
    ├── ActiveLoanHybrid.daml — Active loan template (live loan state)
    ├── SettledLoan.daml     — Final state: successfully repaid
    └── DefaultedLoan.daml   — Final state: defaulted (not repaid by maturity)
```

---

## Parties

| Party | Role |
|-------|------|
| `provider` | Rhein Finance operator. Signatory on **all** templates — ensures Rhein Finance is a confirmer on every sub-transaction for CIP-0104 reward attribution. Also a controller on high-value choices (`AcceptHybrid`, `RepayHybrid`, `ClaimDefaultHybrid`). |
| `initiator` | Party that created the loan offer (borrower on `BorrowerBid`, lender on `LenderAsk`). |
| `borrower` | Party receiving the USDCx principal. |
| `lender` | Party providing the USDCx principal. |

---

## Templates

### `LoanOfferHybrid`

Represents a pending loan offer. Archived when accepted or cancelled.

**Signatories**: `provider`, `initiator`  
**Observers**: `observers` (list — used to make offers visible to counterparties)

**Fields**:

| Field | Type | Description |
|-------|------|-------------|
| `provider` | Party | Rhein Finance operator |
| `initiator` | Party | Offer creator |
| `counterparty` | Optional Party | Specific counterparty (None = open marketplace) |
| `offerType` | OfferType | `BorrowerBid` or `LenderAsk` |
| `lockedCCCollateral` | Optional Text | TransferOffer contract ID of locked CC (BorrowerBid only) |
| `loanAmount` | Decimal | Principal in USDCx |
| `collateralAmount` | Decimal | CC collateral amount |
| `interestRate` | Decimal | Annual rate as decimal (e.g. `0.055` = 5.5%) |
| `maturityDate` | Date | Loan due date |
| `ltvRatio` | Decimal | Loan-to-value ratio |
| `ccPrice` | Decimal | CC price fixed at offer creation |
| `createdAt` | Date | Offer creation date |
| `observers` | [Party] | Parties who can see this offer |

**Ensure**:
- `loanAmount > 0`, `collateralAmount > 0`, `ccPrice > 0`
- `0 < ltvRatio <= 1`
- `0 <= interestRate <= 1`
- `maturityDate > createdAt`
- `BorrowerBid` requires `lockedCCCollateral` to be `Some`

**Choices**:

| Choice | Controllers | Consuming | Description |
|--------|-------------|-----------|-------------|
| `AcceptHybrid` | `provider`, `initiator`, `acceptor` | Yes | Accept offer → creates `ActiveLoanHybrid`. Fires CIP-0104 marker. |
| `RegisterOfferHybrid` | `provider` | No | Fires CIP-0104 marker at offer creation. Does not archive offer. |
| `CancelOfferHybrid` | `initiator` | Yes | Cancel offer. Returns `lockedCCCollateral` reference to caller. |
| `GetOfferDetailsHybrid` | `initiator` | No | Read-only: returns `LoanTerms`. |

**`AcceptHybrid` logic**:
- `BorrowerBid`: `initiator` = borrower (already locked CC), `acceptor` = lender.
- `LenderAsk`: `initiator` = lender, `acceptor` = borrower (provides `acceptorCCReference`).
- Requires all three controllers (`provider`, `initiator`, `acceptor`) to sign.

---

### `ActiveLoanHybrid`

Represents a live loan. Created by `AcceptHybrid`. Archived by `RepayHybrid` or `ClaimDefaultHybrid`.

**Signatories**: `provider`, `borrower`, `lender`

**Fields**:

| Field | Type | Description |
|-------|------|-------------|
| `provider` | Party | Rhein Finance operator |
| `borrower` | Party | Loan borrower |
| `lender` | Party | Loan lender |
| `ccCollateralReference` | Text | TransferOffer contract ID of CC collateral held in admin escrow |
| `principal` | Decimal | Loan principal in USDCx |
| `collateralAmount` | Decimal | CC collateral amount |
| `interestRate` | Decimal | Annual interest rate |
| `maturityDate` | Date | Loan due date |
| `originationDate` | Date | Loan start date |
| `ccPrice` | Decimal | CC price fixed at origination |

**Ensure**:
- `principal > 0`, `collateralAmount > 0`
- `0 <= interestRate <= 1`
- `maturityDate > originationDate`

**Choices**:

| Choice | Controllers | Consuming | Description |
|--------|-------------|-----------|-------------|
| `RepayHybrid` | `provider`, `borrower`, `lender` | Yes | Confirm repayment → creates `SettledLoan`. Returns `ccCollateralReference`. Fires CIP-0104 marker. |
| `ClaimDefaultHybrid` | `provider`, `lender` | Yes | Claim default after maturity → creates `DefaultedLoan`. Returns `ccCollateralReference`. Fires CIP-0104 marker. |
| `AcknowledgeDisbursementHybrid` | `provider` | No | Fires CIP-0104 marker after USDCx disbursement. |
| `RecordCollateralReturnHybrid` | `provider` | No | Fires CIP-0104 marker before collateral is returned. |
| `CalculateRepaymentHybrid` | `borrower` | No | Returns current repayment amount (principal + accrued interest). |
| `CheckMaturityHybrid` | `borrower` | No | Returns whether the loan has matured. |
| `GetLoanDetailsHybrid` | `borrower` | No | Returns `LoanTerms`. |

**`RepayHybrid` validation**:
- `repaymentDate <= maturityDate` (cannot repay after maturity)
- `abs(repaymentAmount - requiredAmount) < 0.01` (exact repayment enforced within 1 cent tolerance for floating-point rounding)

**`ClaimDefaultHybrid` validation**:
- `claimDate >= maturityDate` (cannot claim default before maturity)

---

### `SettledLoan`

Final state — created by `RepayHybrid`. Immutable record of a successful repayment.

**Signatories**: `provider`, `borrower`, `lender`

**Fields**: `provider`, `borrower`, `lender`, `principalRepaid`, `interestPaid`, `collateralReturned`, `settlementDate`

**Ensure**: `principalRepaid > 0`, `interestPaid >= 0`, `collateralReturned > 0`

**Choices**: `GetTotalRepaid` (borrower, non-consuming), `GetSettlementDetails` (borrower, non-consuming)

---

### `DefaultedLoan`

Final state — created by `ClaimDefaultHybrid`. Immutable record of a defaulted loan.

**Signatories**: `provider`, `borrower`, `lender`

**Fields**: `provider`, `borrower`, `lender`, `principal`, `collateralClaimed`, `defaultDate`, `maturityDate`

**Ensure**: `principal > 0`, `collateralClaimed > 0`, `defaultDate >= maturityDate`

**Choices**: `GetDefaultDetails` (lender, non-consuming)

---

## Shared Modules

### `Types.daml`

| Type | Description |
|------|-------------|
| `OfferType` | `BorrowerBid \| LenderAsk` |
| `LoanTerms` | Read-only view of loan parameters |
| `LoanStatus` | `OfferPending \| LoanActive \| LoanSettled \| LoanDefaulted \| OfferCancelled` |
| `SettlementOutcome` | `SuccessfulRepayment \| DefaultClaim` |

### `Utils.daml`

| Function | Description |
|----------|-------------|
| `calculateInterest` | Simple interest: `principal × rate × (days / 365)` |
| `calculateRepaymentAmount` | `principal + interest` |
| `calculateRequiredCollateral` | `loanAmount / (ltv × ccPrice)` |
| `calculateLoanAmount` | `collateral × ltv × ccPrice` |
| `hasMatured` | `currentDate >= maturityDate` |
| `validateLTV` | `0 < ltv <= 1` |
| `validateInterestRate` | `0 <= rate <= 1` |
| `validateAmount` | `amount > 0` |

**Note on `ccPrice`**: A module-level constant (`0.125`) exists in `Utils.daml` but is not used by the templates — each template carries its own `ccPrice` field fixed at contract creation time to prevent oracle manipulation during the loan lifetime.

---

## Contract State Machine

```
                    [LoanOfferHybrid]
                   /                \
          AcceptHybrid          CancelOfferHybrid
                 |                      |
                 ▼                   (archived)
         [ActiveLoanHybrid]
          /              \
    RepayHybrid     ClaimDefaultHybrid
         |                    |
         ▼                    ▼
   [SettledLoan]       [DefaultedLoan]
   (final state)       (final state)
```

---

## CIP-0104 Reward Design

`provider` is a **signatory** on all four templates. This means Rhein Finance is a **confirmer** on every sub-transaction that touches these contracts — including third-party choices — regardless of whether a `FeaturedAppRight` marker is explicitly exercised.

In addition, `FeaturedAppRight_CreateActivityMarker` is explicitly exercised at 5 lifecycle points:

| # | Event | Choice | Template |
|---|-------|--------|----------|
| 1 | Offer registered | `RegisterOfferHybrid` | `LoanOfferHybrid` |
| 2 | Loan originated | `AcceptHybrid` | `LoanOfferHybrid` |
| 3 | USDCx disbursed | `AcknowledgeDisbursementHybrid` | `ActiveLoanHybrid` |
| 4 | Collateral returned | `RecordCollateralReturnHybrid` | `ActiveLoanHybrid` |
| 5 | Loan settled/defaulted | `RepayHybrid` / `ClaimDefaultHybrid` | `ActiveLoanHybrid` |

All marker choices accept `featuredAppRightCid : Optional (ContractId FeaturedAppRight)`. Passing `None` is valid — the marker step is skipped gracefully without failing the main transaction. The `Optional` type also satisfies Canton's upgrade compatibility requirements for new choice fields.

---

## Security Properties

- **Multi-party authorization**: `RepayHybrid` requires all three of `provider`, `borrower`, and `lender` to sign. No single party can unilaterally settle a loan.
- **Maturity enforcement**: `RepayHybrid` rejects repayment after maturity; `ClaimDefaultHybrid` rejects claims before maturity. Both enforced in DAML `do` blocks, not in the backend.
- **Exact repayment**: `RepayHybrid` enforces `abs(repaymentAmount - requiredAmount) < 0.01`. The 0.01 tolerance handles floating-point rounding in the simple interest formula. Repayment is calculated on-chain using the same `calculateRepaymentAmount` function.
- **Immutable CC price**: `ccPrice` is written into `ActiveLoanHybrid` at origination and cannot change — prevents post-origination LTV manipulation.
- **No self-acceptance on-chain**: `AcceptHybrid` requires `acceptor` as a controller distinct from `initiator`. While both are signatories on `LoanOfferHybrid`, the backend additionally enforces that `acceptor != initiator` before submitting.
- **BorrowerBid collateral requirement**: The `ensure` clause on `LoanOfferHybrid` requires `lockedCCCollateral = Some _` for `BorrowerBid` offers — a bid without locked collateral cannot be created on-chain.

---

## Building

```bash
# From the rhein-contracts directory
daml build
```

Outputs: `.daml/dist/rhein-lending-v2-0.5.0.dar`

Requires:
- Daml SDK 3.4.9 (`daml install 3.4.9`)
- `../dars/splice-api-featured-app-v1-1.0.0.dar` present as a data dependency

## Deploying to Canton Participant

```bash
# Upload DAR to participant
daml ledger upload-dar \
  --host <participant-host> \
  --port <ledger-api-port> \
  --access-token-file <token-file> \
  .daml/dist/rhein-lending-v2-0.5.0.dar
```

After upload, update `PACKAGE_ID` in the backend `.env` with the new package hash.
