# Rhein Finance — Backend

NestJS backend for the Rhein Finance P2P lending protocol on the Canton Network (Daml/Canton blockchain). It acts as the orchestration layer between the frontend, the Canton JSON API, the DA utility token API (USDCx), and the Validator Wallet API.

---

## Overview

Rhein Finance is a peer-to-peer lending protocol where:

- **Borrowers** lock Canton Coin (CC) as collateral and receive USDCx (Canton Universal Bridge stablecoin) as the loan principal.
- **Lenders** offer USDCx liquidity in exchange for interest paid in USDCx.
- **Loan terms** (principal, collateral, interest rate, maturity) are enforced by DAML smart contracts on the Canton Network.
- **Protocol fees** are collected in USDCx at loan origination and held in a dedicated fee party.
- **CIP-0104 app rewards** are generated via `FeaturedAppRight_CreateActivityMarker` at every key loan lifecycle event.

---

## Architecture

```
Frontend (React)
      │
      │ HTTPS / Auth0 JWT
      ▼
NestJS Backend  ──── Canton JSON API v2 ──── Canton Ledger (DAML contracts)
      │
      ├── DA Utility API (USDCx token-standard transfer/accept)
      └── Validator Wallet API (CC TransferOffer creation/acceptance)
```

**Authentication**: Auth0 (RS256 JWT). All endpoints require a valid Auth0 bearer token except `GET /api/offers/all` (public marketplace view) and `POST /api/auth/logout`.

**Authorization**: Role-based (`user` / `admin`). Admin routes are protected by `@Roles('admin')`.

**Rate limiting**: 100 requests per minute per IP (global `ThrottlerGuard`).

---

## Tech Stack

| Component | Version |
|-----------|---------|
| Node.js | 18+ |
| NestJS | 11 |
| TypeScript | 5.9 |
| TypeORM + PostgreSQL | 0.3 / pg 8 |
| Auth0 (jwks-rsa) | RS256 JWT validation |
| Helmet | HTTP security headers |
| @nestjs/throttler | Rate limiting |

---

## Environment Variables

| Variable | Description |
|----------|-------------|
| `PORT` | HTTP port (default `3001`) |
| `NODE_ENV` | `development` or `production` |
| `FRONTEND_URL` | CORS allowed origin |
| `DATABASE_HOST/PORT/USERNAME/PASSWORD/NAME` | PostgreSQL connection |
| `JWT_SECRET` | Legacy (unused — auth is via Auth0 JWKS) |
| `AUTH0_DOMAIN` | Auth0 tenant domain |
| `AUTH0_TOKEN_URL` | Auth0 M2M token endpoint |
| `AUTH0_CLIENT_ID` | Auth0 M2M client ID (admin service account) |
| `AUTH0_CLIENT_SECRET` | Auth0 M2M client secret |
| `LEDGER_API_AUTH_AUDIENCE` | Audience for Canton ledger API token (`https://canton.network.global`) |
| `VALIDATOR_AUTH_AUDIENCE` | Audience for Validator Wallet API token |
| `JSON_API_URL` | Canton JSON API v2 base URL (internal Docker IP) |
| `PARTICIPANT_ADMIN_HOST` | Canton participant admin host (for gRPC party allocation) |
| `PARTICIPANT_ADMIN_PORT` | Canton participant admin port |
| `PACKAGE_ID` | DAML package ID of the deployed `rhein-lending-v2` DAR |
| `ADMIN_PARTY_ID` | Rhein Finance admin/operator Canton party ID |
| `DAML_USER_ID` | DAML user ID used for command submission |
| `APPLICATION_ID` | DAML application ID |
| `AMULET_PACKAGE_ID` | Splice/Amulet package ID (for CC queries) |
| `DSO_PARTY_ID` | DSO party ID |
| `PROVIDER_PARTY_ID` | Rhein Finance provider party (CIP-0104 reward beneficiary) |
| `FEE_PARTY_ID` | Party that collects protocol fees in USDCx |
| `ESCROW_PARTY_ID` | Party that holds CC collateral during active loans |
| `VALIDATOR_WALLET_URL` | Validator Wallet API base URL (internal Docker IP) |
| `USDCX_UTILITY_BACKEND_URL` | DA Canton Utilities API base URL |
| `USDCX_ADMIN_PARTY_ID` | USDCx registrar/admin party ID |
| `USDCX_BRIDGE_OPERATOR_PARTY_ID` | Canton Universal Bridge operator party ID |
| `USDCX_UTILITY_OPERATOR_PARTY_ID` | DA utility operator party ID |
| `CC_PRICE` | Fixed CC/USD price used for LTV calculation (e.g. `0.125`) |
| `DEFAULT_LTV` | Default loan-to-value ratio (e.g. `0.50`) |

---

## API Endpoints

All endpoints are prefixed `/api`. JWT bearer token required unless noted.

### Auth

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/auth/status` | Required | Returns authenticated user info |
| POST | `/auth/logout` | Public | Stateless logout (client clears token) |

### Loan Offers

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/offers/all` | Public | Marketplace — all open offers |
| GET | `/offers` | Required | Offers created by or visible to the caller |
| POST | `/offers` | Required | Create a `BorrowerBid` or `LenderAsk` offer |
| POST | `/offers/:contractId/accept` | Required | Accept an offer; triggers CC lock + USDCx disbursement |

### Active Loans

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/loans` | Required | Active loans for the caller |
| POST | `/loans/:contractId/repay` | Required | Repay a loan (USDCx transfer + DAML settlement) |
| POST | `/loans/:contractId/default` | Required | Claim default after maturity |

### Balances

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/balances` | Required | USDCx + CC balances for the caller |

### Wallet

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/wallet/balance` | Required | Combined CC + USDCx balance |
| GET | `/wallet/usdcx/balance` | Required | USDCx balance (available / locked / total) |
| POST | `/wallet/usdcx/transfer` | Required | Send USDCx to another party |
| GET | `/wallet/usdcx/transfers` | Required | List incoming pending USDCx transfers |
| POST | `/wallet/usdcx/transfers/:contractId/accept` | Required | Accept a pending USDCx transfer |
| GET | `/wallet/transfers` | Required | List incoming pending CC transfers |
| POST | `/wallet/transfers/:contractId/accept` | Required | Accept a pending CC transfer |
| POST | `/wallet/transfer/cc` | Required | Send CC to another party |

### Explorer

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/explorer/transactions` | Required | Transaction history for the caller's party |
| GET | `/explorer/transactions/:txId` | Required | Single transaction by ID |
| GET | `/explorer/contracts/:contractId/history` | Required | Contract lifecycle history |

> Regular users can only query their own party. Admins can pass any `partyId` query parameter.

### Admin (role: `admin` required)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/admin/platform-stats` | Live stats: loans, fees, rewards, users |
| GET | `/admin/config` | Current platform config (fee rate) |
| PATCH | `/admin/config` | Update fee rate (0–10%) |
| POST | `/admin/fees/withdraw` | Transfer collected USDCx fees to a recipient |
| GET | `/admin/parties/list` | List all registered Canton parties |

---

## Loan Flow

### BorrowerBid (borrower initiates)

1. Borrower calls `POST /offers` with `offerType: BorrowerBid`.
2. Backend locks CC collateral via Validator Wallet API (`TransferOffer` → admin escrow).
3. DAML `LoanOfferHybrid` contract is created; `RegisterOfferHybrid` marker is exercised. **(Marker 1)**
4. Lender calls `POST /offers/:id/accept`.
5. Backend fetches offer from ledger (never trusts client payload), exercises `AcceptHybrid`. **(Marker 2)**
6. Backend transfers USDCx from lender to borrower (`TransferFactory_Transfer` + auto-accept).
7. `AcknowledgeDisbursementHybrid` marker exercised on the new `ActiveLoanHybrid`. **(Marker 3)**
8. Protocol fee collected from lender in USDCx.

### LenderAsk (lender initiates)

1. Lender calls `POST /offers` with `offerType: LenderAsk`.
2. DAML `LoanOfferHybrid` created; `RegisterOfferHybrid` marker. **(Marker 1)**
3. Borrower calls `POST /offers/:id/accept`.
4. Backend locks CC collateral from borrower into admin escrow.
5. Backend fetches offer from ledger, exercises `AcceptHybrid`. **(Marker 2)**
6. Backend transfers USDCx from lender (admin acts on behalf) to borrower + auto-accepts.
7. `AcknowledgeDisbursementHybrid` marker. **(Marker 3)**
8. Protocol fee collected from lender.

### Repayment

1. Borrower calls `POST /loans/:id/repay` with `repaymentAmount`.
2. Backend transfers USDCx from borrower to lender + auto-accepts.
3. `RecordCollateralReturnHybrid` marker exercised (loan still active). **(Marker 4)**
4. `RepayHybrid` exercised on `ActiveLoanHybrid` → creates `SettledLoan`. **(Marker 5)**
5. CC collateral returned from admin escrow to borrower via Validator Wallet API.

### Default Claim

1. Lender calls `POST /loans/:id/default` after maturity.
2. `RecordCollateralReturnHybrid` marker. **(Marker 4)**
3. `ClaimDefaultHybrid` exercised → creates `DefaultedLoan`. **(Marker 5)**
4. CC collateral sent from admin escrow to lender.

---

## CIP-0104 App Rewards

Every loan lifecycle generates **5 activity markers** via `FeaturedAppRight_CreateActivityMarker`:

| # | Event | Choice |
|---|-------|--------|
| 1 | Offer created | `RegisterOfferHybrid` |
| 2 | Loan originated | `AcceptHybrid` |
| 3 | USDCx disbursed | `AcknowledgeDisbursementHybrid` |
| 4 | Collateral returned | `RecordCollateralReturnHybrid` |
| 5 | Loan settled / defaulted | `RepayHybrid` / `ClaimDefaultHybrid` |

`provider` is a signatory on all DAML templates, ensuring Rhein Finance is a confirmer on every sub-transaction regardless of marker creation.

---

## Key Design Decisions

- **Offer data always fetched from ledger** — `acceptLoanOffer` ignores the client-supplied offer payload entirely and re-fetches from the DAML ACS. This prevents financial logic manipulation via forged request bodies.
- **CC collateral held in admin escrow** — CC is transferred to the admin party on loan creation and returned to the borrower (or lender on default) on settlement. The `ccCollateralReference` field in `ActiveLoanHybrid` stores the original `TransferOffer` contract ID as an audit reference.
- **USDCx via Canton Universal Bridge** — USDCx is a real token bridged from USDC. The backend uses the DA token-standard API (`TransferFactory_Transfer` + `TransferInstruction_Accept`) for all USDCx transfers.
- **Fixed CC price** — CC price is fixed at contract origination (`ccPrice` field in `ActiveLoanHybrid`) to prevent oracle manipulation during the loan lifetime.
- **All DAML commands use admin M2M token** — the backend holds actAs rights for all user parties via `grantAdminActAs`, allowing it to submit commands on behalf of users without requiring the user's token for ledger operations.

---

## Running Locally

```bash
# Install dependencies
npm install

# Set up environment
cp .env.example .env
# Edit .env with your Canton Network and Auth0 credentials

# Development (hot reload)
npm run dev

# Production build
npm run build
npm run start:prod
```

Requires:
- PostgreSQL running on `DATABASE_HOST:DATABASE_PORT`
- Canton participant JSON API accessible at `JSON_API_URL`
- Validator Wallet API accessible at `VALIDATOR_WALLET_URL`
- Auth0 M2M application credentials in `.env`

---

## Security Notes

See [SECURITY_AUDIT.md](SECURITY_AUDIT.md) for the full internal security audit report.

Key points:
- Auth0 RS256 JWT validation via JWKS — tokens are verified against Auth0's public keys, not a shared secret.
- Rate limiting: 100 req/min globally.
- Input validation: `class-validator` with `whitelist: true`, `forbidNonWhitelisted: true`.
- Swagger UI is disabled when `NODE_ENV=production`.
- Admin endpoints require `role: admin` stored in the database (set via direct DB or `makeAdmin` method — no self-promotion possible).
