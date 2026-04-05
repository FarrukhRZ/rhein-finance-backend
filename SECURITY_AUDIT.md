# Rhein Finance Backend — Security Audit Report

**Date**: 2026-04-02 (updated 2026-04-05)
**Auditor**: Internal (pre-external-audit review)
**Scope**: NestJS backend (`/src`), DAML contracts (`rhein-contracts/daml`)
**Version**: Backend `main` branch @ `dcfcebf`, DAML contracts v0.6.0

---

## Executive Summary

The Rhein Finance backend is a NestJS application that orchestrates a P2P lending protocol on the Canton Network. Authentication is handled via Auth0 (RS256 JWT), authorization via role-based guards, and financial logic is enforced on-chain through DAML smart contracts.

Two critical vulnerabilities were identified that allow financial logic manipulation at the HTTP layer before DAML contract enforcement. Five high/medium issues were identified related to missing guards, unvalidated input, and information disclosure. All critical and high findings have been resolved. Post-audit improvements include Canton transaction batching, USDCx and CC TransferPreapproval support, and a new DAML activity marker.

**Risk Rating: MEDIUM** — all critical and high findings resolved; remaining items are low/informational.

---

## Findings Summary

| ID | Severity | Title | Status |
|----|----------|-------|--------|
| CRIT-1 | 🔴 Critical | Client-supplied offer payload used for financial logic | ✅ Fixed |
| CRIT-2 | 🔴 Critical | `claimDate` override allows forcing default on non-matured loans | ✅ Fixed |
| HIGH-1 | 🟠 High | Rate limiting module registered but guard never applied | ✅ Fixed |
| HIGH-2 | 🟠 High | Explorer endpoints fully public — leaks all party transaction history | ✅ Fixed |
| HIGH-3 | 🟠 High | `/admin/database/clear` has no confirmation safeguard | ✅ Fixed |
| MED-1 | 🟡 Medium | `forbidNonWhitelisted: false` — unknown fields silently stripped | ✅ Fixed |
| MED-2 | 🟡 Medium | Fee withdrawal recipient party ID has no format validation | ✅ Fixed |
| MED-3 | 🟡 Medium | `AcceptOfferDto.offer` untyped — no structural validation | ✅ Fixed (superseded by CRIT-1 fix) |
| MED-4 | 🟡 Medium | `repaymentAmount` has no minimum value constraint | ✅ Fixed |
| MED-5 | 🟡 Medium | Swagger UI publicly accessible in production | ✅ Fixed |
| MED-6 | 🟡 Medium | `synchronize` relies on `NODE_ENV` — footgun if unset in production | Open |
| LOW-1 | 🔵 Low | Loan repayment ownership not verified at HTTP layer | Open |
| LOW-2 | 🔵 Low | Raw internal errors leaked to HTTP responses | Open |
| LOW-3 | 🔵 Low | No structured logging — verbose console output in production | Open |
| LOW-4 | 🔵 Low | `ADMIN_KEY` defined in env but never consumed | Open |
| PA-LOW-1 | 🔵 Low | Preapproval startup failures silently swallowed | Acknowledged |
| PA-LOW-2 | 🔵 Low | `deduplication_id` was randomised — no retry protection | ✅ Fixed |
| PA-INFO-1 | ℹ️ Info | `offerContractId` fallback to tracking string on preapproval path | ✅ Fixed (audit log clarified) |
| PA-INFO-2 | ℹ️ Info | `RecordFeeCollectionHybrid` has no idempotency guard | Open (known, see below) |
| PA-KI-1 | ⚠️ Known Issue | Multi-step flows are not atomic — partial failure risk | Open (planned) |

---

## Detailed Findings

---

### CRIT-1 — Client-Supplied Offer Payload Used for Financial Logic

**Severity**: Critical | **Status**: ✅ Fixed (`acceptLoanOffer` now fetches offer from ledger via `getLoanOfferByContractId` and ignores client payload for all financial logic)

**Description**

When a user accepts a loan offer, the frontend sends the full offer object in the request body (`AcceptOfferDto.offer`). The backend then used fields from this client-supplied object — including `offer.payload.loanAmount`, `offer.payload.offerType`, and `offer.payload.initiator` — to determine:

- How much USDCx to disburse to the borrower
- Whether the caller is acting as lender or borrower
- Which party to collect fees from

A malicious user could forge these values to manipulate disbursement amounts, swap lender/borrower roles, or avoid fee collection, all without touching the on-chain DAML contract.

**Fix Applied**

```typescript
// SECURITY: Always fetch offer from the ledger — never trust the client-supplied payload
const offer = await this.getLoanOfferByContractId(offerContractId);
if (!offer) throw new Error(`Offer ${offerContractId} not found on ledger`);
if (offer.payload.initiator === partyId) throw new Error('Cannot accept your own loan offer');
```

---

### CRIT-2 — `claimDate` Override Allows Forcing Default on Non-Matured Loans

**Severity**: Critical | **Status**: ✅ Fixed (`claimDate` now restricted to `admin` role)

**Description**

The `DefaultLoanDto` exposed an optional `claimDate` field that overrode the current date in the default-claim flow. Any authenticated user who knew a loan's `contractId` could pass a future date to satisfy the DAML contract's `claimDate >= maturityDate` check, forcing a default on a non-matured loan.

**Fix Applied**

```typescript
if (dto.claimDate && user.role !== 'admin') {
  throw new ForbiddenException('claimDate override requires admin role');
}
```

---

### HIGH-1 — Rate Limiting Module Registered but Guard Never Applied

**Severity**: High | **Status**: ✅ Fixed (`ThrottlerGuard` added to global `APP_GUARD` providers)

---

### HIGH-2 — Explorer Endpoints Fully Public

**Severity**: High | **Status**: ✅ Fixed (`@Public()` removed; endpoints require authentication and restrict `partyId` to requesting user unless admin)

---

### HIGH-3 — `/admin/database/clear` Has No Confirmation Safeguard

**Severity**: High | **Status**: ✅ Fixed (confirmation string required; action logged before execution)

---

### MED-1 — `forbidNonWhitelisted: false`

**Severity**: Medium | **Status**: ✅ Fixed (`forbidNonWhitelisted: true` set in `ValidationPipe`)

---

### MED-2 — Fee Withdrawal Recipient Party ID Has No Format Validation

**Severity**: Medium | **Status**: ✅ Fixed (regex pattern `@Matches(/^[A-Za-z0-9_-]+::1220[a-f0-9]{64}$/)` applied)

---

### MED-3 — `AcceptOfferDto.offer` Untyped

**Severity**: Medium | **Status**: ✅ Fixed (superseded by CRIT-1 fix — offer is fetched from ledger, client payload is ignored for financial logic)

---

### MED-4 — `repaymentAmount` Has No Minimum Value

**Severity**: Medium | **Status**: ✅ Fixed (`@Min(0.000001)` added to `RepayLoanDto`)

---

### MED-5 — Swagger UI Publicly Accessible in Production

**Severity**: Medium | **Status**: ✅ Fixed (Swagger only mounted when `NODE_ENV !== 'production'`)

---

### MED-6 — TypeORM `synchronize` Depends on `NODE_ENV` Being Set

**Severity**: Medium | **Status**: Open

If `NODE_ENV` is not set in production, `synchronize: configService.get('NODE_ENV') === 'development'` evaluates to `false` — safe by accident. A deployment that omits `NODE_ENV` could accidentally enable auto-sync. Use TypeORM migrations for production schema changes.

---

### LOW-1 — Loan Repayment Ownership Not Verified at HTTP Layer

**Severity**: Low | **Status**: Open

`POST /loans/:contractId/repay` does not verify the calling user is the borrower before initiating the USDCx transfer. The DAML contract rejects unauthorized repayment, but the transfer is attempted first. Add a borrower check before the transfer:

```typescript
if (loan.payload.borrower !== partyId) {
  throw new ForbiddenException('Only the borrower can repay this loan');
}
```

---

### LOW-2 — Raw Internal Errors Leaked to HTTP Responses

**Severity**: Low | **Status**: Open

Internal errors from the Canton JSON API, DA utility backend, and wallet API propagate to HTTP responses with full message strings (party IDs, contract IDs, ledger offsets). Implement a NestJS exception filter mapping internal errors to generic user-facing messages.

---

### LOW-3 — No Structured Logging in Production

**Severity**: Low | **Status**: Open

All logging uses `console.log`/`console.error`. Integrate a structured logger (NestJS Logger, Winston, or Pino) with log levels and JSON output for production observability.

---

### LOW-4 — `ADMIN_KEY` Defined in Environment But Never Consumed

**Severity**: Low | **Status**: Open

`ADMIN_KEY=change-me-in-production` is present in env but never read. Admin access is handled via Auth0 role claims. Remove to avoid confusion.

---

## Post-Audit Findings (PA series)

These findings were identified during a follow-up review of post-audit changes.

---

### PA-LOW-1 — Preapproval Startup Failures Silently Swallowed

**Severity**: Low | **Status**: Acknowledged

`onModuleInit` catches and warns on preapproval creation failures. If USDCx or CC TransferPreapproval creation fails at startup, the system silently falls back to explicit accepts — which may fail at runtime with no obvious root cause. Not a security issue but a reliability risk. Planned improvement: add startup health check that surfaces preapproval state.

---

### PA-LOW-2 — `deduplication_id` Was Randomised on CC Preapproval Transfers

**Severity**: Low | **Status**: ✅ Fixed

`transfer-preapproval/send` was called with a random `deduplication_id`, providing no retry protection. A network failure causing a retry could result in double-collateral-lock or double-return.

**Fix Applied**: `lockAmulet` now accepts an optional `deduplicationId` parameter. Callers pass deterministic values — the offer contract ID (LenderAsk accept) or a stable hash of `partyId + amount + maturityDate` (BorrowerBid offer). `returnCCCollateral` uses the loan contract ID as dedup anchor.

---

### PA-INFO-1 — `offerContractId` Fallback to Tracking String on Preapproval Path

**Severity**: Informational | **Status**: ✅ Fixed (audit log clarified)

When using `transfer-preapproval/send`, there is no offer contract ID. The result's `transaction_id` (or tracking string) was being stored as `lockedCCCollateral` / `ccCollateralReference`. Downstream code does not exercise choices on this value (it is an `Optional Text` audit field in DAML), but the ambiguity was confusing.

**Fix Applied**: Logged explicitly as `audit ref` with a comment clarifying no downstream code exercises choices on this value.

---

### PA-INFO-2 — `RecordFeeCollectionHybrid` Has No Idempotency Guard

**Severity**: Informational | **Status**: Open (known design decision)

`RecordFeeCollectionHybrid` is a `nonconsuming` choice with no check that a fee was actually collected or that the marker hasn't been recorded before. It can be exercised multiple times by the `provider` party, which could inflate CIP-0104 activity marker rewards.

**Assessment**: Blast radius is limited to inflated validator rewards — no fund movement is possible through this choice. The `nonconsuming` pattern is consistent with the other activity marker choices (`AcknowledgeDisbursementHybrid`, `RecordCollateralReturnHybrid`). Recommend adding a boolean flag `feeRecorded : Bool` to `ActiveLoanHybrid` to guard against re-exercise in a future DAML version.

---

## Known Issues

---

### PA-KI-1 — Multi-Step Flows Are Not Atomic

**Severity**: ⚠️ Known Issue | **Status**: Open (planned)

The loan lifecycle involves multiple sequential Canton transactions and external API calls that cannot be made atomic at the backend layer. A failure partway through any flow leaves the system in a partially-completed state.

**Affected flows and failure scenarios:**

| Flow | Step that fails | Consequence |
|------|----------------|-------------|
| BorrowerBid offer creation | CC locked → loan offer creation fails | CC stuck in admin escrow indefinitely |
| Acceptance | `AcceptHybrid` succeeds → USDCx disbursement fails | Loan active on-chain, borrower never receives funds |
| Acceptance | USDCx disbursed → fee collection fails | Lender short the fee; no automatic recovery |
| Repayment | `RepayHybrid` succeeds → CC return fails | Borrower repaid USDCx but never recovers CC collateral |

**Root cause**: True atomicity across multiple Canton transactions is not achievable at the API layer. The DA token standard (`TransferFactory_Transfer`) cannot be invoked from within our DAML choices, preventing a single-transaction design.

**Planned mitigations:**
1. **Compensation on CC lock failure** — if offer creation fails after CC lock, immediately return CC to borrower
2. **Retry queue for CC return** — persist failed CC return operations to DB; background job retries with deterministic deduplication IDs (already in place)
3. **Monitoring + alerting** — structured logging (LOW-3) will surface partial failures for manual intervention

**Current state**: Critical financial steps (CC lock, USDCx transfer, CC return) log detailed errors. The deduplication hardening (PA-LOW-2) ensures retries are safe. Activity markers are non-fatal and do not block financial flows.

---

## DAML Contract Findings

The DAML contracts (`ActiveLoanHybrid`, `LoanOfferHybrid`, `SettledLoan`, `DefaultedLoan`) were reviewed and found to be **well-structured** with the following positive observations:

- All financial choices require multi-party authorization (`provider, borrower, lender` as signatories/controllers)
- `ensure` blocks validate amounts, rates, and date ordering at contract creation
- `FeaturedAppRight` exercises use `Optional (ContractId FeaturedAppRight)` allowing graceful degradation
- `RepayHybrid` enforces exact repayment amount (within 0.01 tolerance)
- `ClaimDefaultHybrid` enforces maturity date before allowing default
- New choice fields use `Optional` for upgrade compatibility

**Minor observation**: The 0.01 USDCx tolerance in `RepayHybrid` (`abs (repaymentAmount - requiredAmount) < 0.01`) is intentional to handle floating-point rounding but should be noted to external auditors as a design decision, not a bug.

---

## Post-Audit Changes Summary

The following improvements were made after the initial audit report (2026-04-02 → 2026-04-05):

### DAML (v0.5.0 → v0.6.0)
- Added `RecordFeeCollectionHybrid` — 6th CIP-0104 activity marker (nonconsuming, controller: `provider`)

### Backend (`daml.service.ts`)
- **Canton transaction batching**: reduced from 8 to 4 Canton transactions per full loan lifecycle
  - Offer creation: `CreateAndExercise` (create `LoanOfferHybrid` + `RegisterOfferHybrid` in one tx)
  - Acceptance: `AcknowledgeDisbursementHybrid` + `RecordFeeCollectionHybrid` batched in one tx
  - Repayment: `RecordCollateralReturnHybrid` + `RepayHybrid` batched in one tx
  - Default: `RecordCollateralReturnHybrid` + `ClaimDefaultHybrid` batched in one tx
- **USDCx TransferPreapproval**: eliminates `TransferInstruction_Accept` Canton transaction for fee, disbursement, and repayment transfers when parties have pre-approval. `rhein-fees` pre-approval auto-created on startup.
- **CC TransferPreapproval**: uses `POST /wallet/transfer-preapproval/send` (direct atomic transfer) instead of `TransferOffer` + explicit accept when receiver has `Splice.AmuletRules:TransferPreapproval`. Admin pre-approval auto-created on startup.
- **Package IDs moved to env vars**: `USDCX_REGISTRY_APP_PACKAGE_ID` and `USDCX_HOLDING_PACKAGE_ID` (mainnet values differ from testnet)
- **Deterministic deduplication IDs**: CC preapproval transfers use offer/loan contract ID as `deduplication_id` instead of random value

---

## Recommended Fix Priority

### Immediate (before any external users)
- ✅ CRIT-1, CRIT-2, HIGH-1 — resolved

### Before External Audit
- ✅ HIGH-2, HIGH-3, MED-1 through MED-5 — resolved
- Open: MED-6, LOW-1 through LOW-4

### Before Mainnet Launch
- PA-KI-1 — implement compensation + retry queue for partial flow failures
- PA-INFO-2 — add `feeRecorded` guard to `RecordFeeCollectionHybrid` in DAML v0.7.0
- PA-LOW-1 — startup health check for preapproval state
- Structured logging (LOW-3)
- TypeORM migration setup (MED-6)
- External professional smart contract and API security audit

---

*Report generated by internal review. Not a substitute for a professional security audit.*
