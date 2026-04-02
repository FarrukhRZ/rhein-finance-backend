# Rhein Finance Backend — Security Audit Report

**Date**: 2026-04-02  
**Auditor**: Internal (pre-external-audit review)  
**Scope**: NestJS backend (`/src`), DAML contracts (`rhein-contracts/daml`)  
**Version**: Backend `main` branch @ `fdeaeff`, DAML contracts v0.5.0

---

## Executive Summary

The Rhein Finance backend is a NestJS application that orchestrates a P2P lending protocol on the Canton Network. Authentication is handled via Auth0 (RS256 JWT), authorization via role-based guards, and financial logic is enforced on-chain through DAML smart contracts.

Two critical vulnerabilities were identified that allow financial logic manipulation at the HTTP layer before DAML contract enforcement. Five high/medium issues were identified related to missing guards, unvalidated input, and information disclosure. These should be resolved before engaging an external auditor.

**Risk Rating: HIGH** — due to the two critical findings.

---

## Findings Summary

| ID | Severity | Title | Status |
|----|----------|-------|--------|
| CRIT-1 | 🔴 Critical | Client-supplied offer payload used for financial logic | Open |
| CRIT-2 | 🔴 Critical | `claimDate` override allows forcing default on non-matured loans | Open |
| HIGH-1 | 🟠 High | Rate limiting module registered but guard never applied | Open |
| HIGH-2 | 🟠 High | Explorer endpoints fully public — leaks all party transaction history | Open |
| HIGH-3 | 🟠 High | `/admin/database/clear` has no confirmation safeguard | Open |
| MED-1 | 🟡 Medium | `forbidNonWhitelisted: false` — unknown fields silently stripped | Open |
| MED-2 | 🟡 Medium | Fee withdrawal recipient party ID has no format validation | Open |
| MED-3 | 🟡 Medium | `AcceptOfferDto.offer` untyped — no structural validation | Open |
| MED-4 | 🟡 Medium | `repaymentAmount` has no minimum value constraint | Open |
| MED-5 | 🟡 Medium | Swagger UI publicly accessible in production | Open |
| MED-6 | 🟡 Medium | `synchronize` relies on `NODE_ENV` — footgun if unset in production | Open |
| LOW-1 | 🔵 Low | Loan repayment ownership not verified at HTTP layer | Open |
| LOW-2 | 🔵 Low | Raw internal errors leaked to HTTP responses | Open |
| LOW-3 | 🔵 Low | No structured logging — verbose console output in production | Open |
| LOW-4 | 🔵 Low | `ADMIN_KEY` defined in env but never consumed | Open |

---

## Detailed Findings

---

### CRIT-1 — Client-Supplied Offer Payload Used for Financial Logic

**Severity**: Critical  
**File**: `src/loans/loans.controller.ts:60`, `src/loans/dto/accept-offer.dto.ts`

**Description**

When a user accepts a loan offer, the frontend sends the full offer object in the request body (`AcceptOfferDto.offer`). The backend then uses fields from this client-supplied object — including `offer.payload.loanAmount`, `offer.payload.offerType`, and `offer.payload.initiator` — to determine:

- How much USDCx to disburse to the borrower
- Whether the caller is acting as lender or borrower
- Which party to collect fees from

A malicious user can forge these values to manipulate disbursement amounts, swap lender/borrower roles, or avoid fee collection, all without touching the on-chain DAML contract.

**Affected Code**

```typescript
// loans.controller.ts
const result = await this.loansService.acceptOffer(contractId, user.partyId, dto.offer, user.rawToken);

// daml.service.ts — uses dto.offer.payload.loanAmount for USDCx transfer amount
const loanAmount = parseFloat(offer.payload.loanAmount);
// uses dto.offer.payload.offerType to determine lender vs borrower
if (offer.payload.offerType === 'BorrowerBid') { ... } else { ... }
```

**Recommendation**

Never trust client-supplied financial data. Fetch the offer directly from the DAML ledger by `contractId` inside `acceptLoanOffer`, and derive all values from that authoritative source:

```typescript
// Fetch from ledger, not from client
const offers = await this.queryContracts([this.templateId('LoanOfferHybrid:LoanOfferHybrid')], [partyId]);
const offer = offers.find(o => o.contractId === offerContractId);
if (!offer) throw new NotFoundException('Offer not found on ledger');
```

---

### CRIT-2 — `claimDate` Override Allows Forcing Default on Non-Matured Loans

**Severity**: Critical  
**File**: `src/loans/dto/default-loan.dto.ts`, `src/loans/loans.controller.ts:104`

**Description**

The `DefaultLoanDto` exposes an optional `claimDate` field that overrides the current date in the default-claim flow. It has only `@IsString() @IsOptional()` validation — no date format check, no constraint that the date must be today or in the past, and no admin-only restriction.

Any authenticated user who knows a loan's `contractId` can pass a future date to override the maturity check in the DAML contract, forcing a default on a loan that hasn't yet matured. The DAML contract enforces `claimDate >= maturityDate`, so an attacker would pass a date far enough in the future to satisfy that check.

**Affected Code**

```typescript
// default-loan.dto.ts
@IsString()
@IsOptional()
claimDate?: string;  // No max date, no format validation
```

**Recommendation**

Remove `claimDate` from the DTO entirely for production. It was added for testing. If admin override is needed, restrict it to the `admin` role:

```typescript
// Only allow override if caller is admin
if (dto.claimDate && user.role !== 'admin') {
  throw new ForbiddenException('claimDate override requires admin role');
}
```

---

### HIGH-1 — Rate Limiting Module Registered but Guard Never Applied

**Severity**: High  
**File**: `src/app.module.ts:42`

**Description**

`ThrottlerModule` is imported and configured (100 requests/min) but `ThrottlerGuard` is never added to the global `APP_GUARD` providers. Rate limiting is completely inactive across all endpoints, including high-value ones that trigger on-chain transactions (`POST /offers`, `POST /offers/:id/accept`, `POST /loans/:id/repay`).

**Affected Code**

```typescript
// app.module.ts — ThrottlerModule configured but guard missing
ThrottlerModule.forRoot([{ ttl: 60000, limit: 100 }]),

providers: [
  { provide: APP_GUARD, useClass: JwtAuthGuard },
  { provide: APP_GUARD, useClass: RolesGuard },
  // ThrottlerGuard missing
],
```

**Recommendation**

```typescript
import { ThrottlerGuard } from '@nestjs/throttler';

providers: [
  { provide: APP_GUARD, useClass: ThrottlerGuard },
  { provide: APP_GUARD, useClass: JwtAuthGuard },
  { provide: APP_GUARD, useClass: RolesGuard },
],
```

Consider applying stricter limits to the loan/offer endpoints specifically using `@Throttle()`.

---

### HIGH-2 — Explorer Endpoints Fully Public, Leaks All Party Transaction History

**Severity**: High  
**File**: `src/explorer/explorer.controller.ts:8`

**Description**

The entire `ExplorerController` is decorated with `@Public()`, bypassing JWT authentication. Any unauthenticated caller can query:

- Full transaction history for any party ID (`GET /explorer/transactions?partyId=...`)
- Any individual transaction by ID
- Complete contract lifecycle history for any contract ID

This leaks financial activity (loan amounts, counterparties, repayment history) for all platform users.

**Recommendation**

Remove `@Public()` from the controller. Require authentication and restrict `partyId` query parameter to the requesting user's own `partyId` (unless admin):

```typescript
async getTransactions(@CurrentUser() user: User, @Query('partyId') partyId?: string) {
  const effectivePartyId = user.role === 'admin' ? (partyId || user.partyId) : user.partyId;
  // ...
}
```

---

### HIGH-3 — `/admin/database/clear` Has No Confirmation Safeguard

**Severity**: High  
**File**: `src/admin/admin.controller.ts:157`, `src/admin/admin.service.ts:398`

**Description**

`POST /api/admin/database/clear` deletes all parties and deposits with no confirmation token, no dry-run mode, and no audit log. A single compromised admin account results in irreversible data loss. The endpoint is protected by the `admin` role, but that is the only safeguard.

**Recommendation**

Require an explicit confirmation string in the request body, and log the action before executing:

```typescript
async clearDatabase(@Body() body: { confirm: string }) {
  if (body.confirm !== 'DELETE_ALL_DATA') {
    throw new BadRequestException('Must pass { "confirm": "DELETE_ALL_DATA" }');
  }
  console.error(`[AUDIT] Database cleared by admin at ${new Date().toISOString()}`);
  // proceed
}
```

---

### MED-1 — `forbidNonWhitelisted: false` — Unknown Fields Silently Stripped

**Severity**: Medium  
**File**: `src/main.ts:33`

**Description**

`ValidationPipe` is configured with `whitelist: true` (unknown fields are stripped) but `forbidNonWhitelisted: false` (no error is thrown). Unexpected fields pass through silently. Combined with DTOs typed as `any`, this reduces the effectiveness of input validation.

**Recommendation**

```typescript
new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,  // Return 400 on unexpected fields
  transform: true,
})
```

---

### MED-2 — Fee Withdrawal Recipient Party ID Has No Format Validation

**Severity**: Medium  
**File**: `src/admin/dto/withdraw-fees.dto.ts`

**Description**

`WithdrawFeesDto.recipientPartyId` is validated only as `@IsString()`. Any arbitrary string is accepted, including malformed party IDs that will fail at the DAML layer with an opaque error.

**Recommendation**

```typescript
@Matches(/^[A-Za-z0-9_-]+::1220[a-f0-9]{64}$/, {
  message: 'Invalid party ID format',
})
recipientPartyId: string;
```

---

### MED-3 — `AcceptOfferDto.offer` Is Untyped With No Structural Validation

**Severity**: Medium  
**File**: `src/loans/dto/accept-offer.dto.ts`

**Description**

`offer` is typed as `any` with only `@IsObject()`. If the payload is missing expected fields (e.g. `offer.payload.initiator`), the service throws a null dereference deep in the call stack, returning a 500 instead of a clean 400.

This is secondary to CRIT-1 — once the offer is fetched from the ledger instead of the client, this DTO becomes irrelevant for financial logic.

**Recommendation**

Define a typed nested DTO class for the offer structure with proper validators, or eliminate the field entirely once CRIT-1 is fixed.

---

### MED-4 — `repaymentAmount` Has No Minimum Value

**Severity**: Medium  
**File**: `src/loans/dto/repay-loan.dto.ts`

**Description**

`@IsNumber()` with no `@Min(...)` allows zero or negative repayment amounts. The USDCx transfer would be attempted before the DAML contract rejects it.

**Recommendation**

```typescript
@Min(0.000001, { message: 'repaymentAmount must be positive' })
repaymentAmount: number;
```

---

### MED-5 — Swagger UI Publicly Accessible in Production

**Severity**: Medium  
**File**: `src/main.ts:72`

**Description**

`/api/docs` is exposed with no authentication and no environment guard. It documents every endpoint, parameter, schema, and example value — lowering the bar for API reconnaissance.

**Recommendation**

```typescript
if (configService.get('NODE_ENV') !== 'production') {
  SwaggerModule.setup('api/docs', app, document);
}
```

---

### MED-6 — TypeORM `synchronize` Depends on `NODE_ENV` Being Set

**Severity**: Medium  
**File**: `src/app.module.ts:35`

**Description**

```typescript
synchronize: configService.get('NODE_ENV') === 'development'
```

If `NODE_ENV` is not set in production, this evaluates to `false` — safe. But this is implicit. A deployment that omits `NODE_ENV` could accidentally enable auto-sync, which can silently alter the production database schema.

**Recommendation**

Explicitly disable synchronize in all non-development environments:

```typescript
synchronize: configService.get('NODE_ENV') === 'development' && configService.get('DB_SYNC') === 'true',
```

Use TypeORM migrations for production schema changes.

---

### LOW-1 — Loan Repayment Ownership Not Verified at HTTP Layer

**Severity**: Low  
**File**: `src/loans/loans.controller.ts:80`

**Description**

`POST /loans/:contractId/repay` does not verify that the calling user is the borrower of the loan before proceeding. The DAML contract will reject unauthorized repayment (since `provider, borrower, lender` are all required signatories on `RepayHybrid`), but the USDCx transfer is initiated first, potentially creating a locked holding before the DAML step fails.

**Recommendation**

Add a borrower check before initiating the transfer:

```typescript
if (loan.payload.borrower !== partyId) {
  throw new ForbiddenException('Only the borrower can repay this loan');
}
```

---

### LOW-2 — Raw Internal Errors Leaked to HTTP Responses

**Severity**: Low  
**File**: `src/daml/daml.service.ts` (multiple locations)

**Description**

Internal errors from the Canton JSON API, DA utility backend, and wallet API are thrown directly as `Error` objects with their full message strings, which propagate to the HTTP response. These messages may contain party IDs, contract IDs, ledger offset values, and stack traces.

**Recommendation**

Implement a NestJS exception filter that maps internal errors to generic user-facing messages, logging the full detail server-side only.

---

### LOW-3 — No Structured Logging in Production

**Severity**: Low  
**File**: Throughout `src/daml/daml.service.ts`, `src/admin/admin.service.ts`

**Description**

All logging uses `console.log`/`console.error`. In production this produces unstructured output, making log aggregation, alerting, and incident response difficult. Auth0 token fetches, DAML command submissions, and USDCx transfers all produce log lines that are not queryable.

**Recommendation**

Integrate a structured logger (NestJS built-in Logger, Winston, or Pino) with log levels (`debug`, `info`, `warn`, `error`) and JSON output format.

---

### LOW-4 — `ADMIN_KEY` Defined in Environment But Never Consumed

**Severity**: Low  
**File**: `.env`

**Description**

`ADMIN_KEY=change-me-in-production` is present in the environment configuration but is never read by the application. Admin access is correctly handled via Auth0 role claims. The dangling variable is misleading and the placeholder value could cause confusion.

**Recommendation**

Remove `ADMIN_KEY` from `.env` and any `.env.example` files to avoid confusion.

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

## Recommended Fix Priority

### Immediate (before any external users)
1. **CRIT-1** — Fetch offer from ledger in `acceptLoanOffer`, discard client payload for financial logic
2. **CRIT-2** — Remove `claimDate` from DTO or restrict to admin role
3. **HIGH-1** — Add `ThrottlerGuard` to global providers

### Before External Audit
4. **HIGH-2** — Restrict explorer endpoints to authenticated users
5. **HIGH-3** — Add confirmation safeguard to database clear
6. **MED-1** — Set `forbidNonWhitelisted: true`
7. **MED-4** — Add `@Min` to `repaymentAmount`
8. **MED-5** — Disable Swagger in production

### Before Mainnet Launch
9. All remaining medium and low findings
10. Structured logging implementation
11. TypeORM migration setup (replace `synchronize`)
12. External professional smart contract and API security audit

---

*Report generated by internal review. Not a substitute for a professional security audit.*
