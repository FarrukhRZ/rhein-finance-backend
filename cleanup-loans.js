/**
 * One-time cleanup: archive all ActiveLoanHybrid contracts that were created
 * without USDCx disbursement, and unlock their CC collateral.
 */

const https = require('https');
const http = require('http');

// Config from .env
const AUTH0_TOKEN_URL = 'https://dev-6sfr03bu1tmm7q5e.us.auth0.com/oauth/token';
const AUTH0_CLIENT_ID = 'PUdptaRslnfyzkVUxzAVdOWNMMAmJnHt';
const AUTH0_CLIENT_SECRET = 'rb77mPzl1BvLFa51osRSUR4bGD_11xZRQgz0EUdIF-r-nV-QK6InGjdsrHcCT7sz';
const AUDIENCE = 'https://canton.network.global';

const JSON_API_URL = 'http://172.18.0.5:7575';
const VALIDATOR_WALLET_URL = 'http://172.18.0.6:5003';
const PACKAGE_ID = '96ec80d9703611f5b44eff63e3c1db47709c590363aaf6723eeef86b28bb819e';
const ADMIN_PARTY_ID = 'rhein-test-6559::12200868e62eb044f47552f943d03545973cd87fa0662a613d534d43f11a281e23c0';
const ALL_PARTIES = [
  'google-oauth2_007c102290181257625603362::12200868e62eb044f47552f943d03545973cd87fa0662a613d534d43f11a281e23c0',
  'rhein-test-6559::12200868e62eb044f47552f943d03545973cd87fa0662a613d534d43f11a281e23c0',
];
const DAML_USER_ID = 'PUdptaRslnfyzkVUxzAVdOWNMMAmJnHt@clients';

function fetch(url, options = {}) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const lib = parsedUrl.protocol === 'https:' ? https : http;
    const req = lib.request(url, {
      method: options.method || 'GET',
      headers: options.headers || {},
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, text: () => data, json: () => JSON.parse(data) });
      });
    });
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

async function getToken() {
  const res = await fetch(AUTH0_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ grant_type: 'client_credentials', client_id: AUTH0_CLIENT_ID, client_secret: AUTH0_CLIENT_SECRET, audience: AUDIENCE }),
  });
  const data = res.json();
  console.log(`Got token (expires_in: ${data.expires_in}s)`);
  return data.access_token;
}

async function getLedgerEnd(token) {
  const res = await fetch(`${JSON_API_URL}/v2/state/ledger-end`, { headers: { 'Authorization': `Bearer ${token}` } });
  const data = res.json();
  return data.offset || 999999999;
}

async function queryActiveLoans(token) {
  const offset = await getLedgerEnd(token);
  const templateId = `${PACKAGE_ID}:ActiveLoanHybrid:ActiveLoanHybrid`;
  const filtersByParty = {};
  for (const party of ALL_PARTIES) {
    filtersByParty[party] = {
      cumulative: [{
        identifierFilter: { TemplateFilter: { value: { templateId, includeCreatedEventBlob: false } } },
        templateFilters: [],
      }],
    };
  }

  const body = JSON.stringify({
    userId: DAML_USER_ID,
    filter: { filtersByParty },
    activeAtOffset: offset,
  });

  const res = await fetch(`${JSON_API_URL}/v2/state/active-contracts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body,
  });

  if (!res.ok) {
    throw new Error(`Query failed (${res.status}): ${res.text()}`);
  }

  const text = res.text();
  const entries = JSON.parse(text);
  const loans = [];
  for (const entry of entries) {
    const evt = entry.contractEntry?.JsActiveContract?.createdEvent;
    if (evt) {
      loans.push({
        contractId: evt.contractId,
        payload: evt.createArgument,
      });
    }
  }
  return loans;
}

async function repayLoan(token, loan) {
  const today = new Date().toISOString().split('T')[0];
  const principal = parseFloat(loan.payload.principal);
  // Same-day repayment: interest = 0, repaymentAmount = principal
  const repaymentAmount = principal.toString();

  console.log(`  Exercising RepayHybrid: principal=${principal}, borrower=${loan.payload.borrower}, lender=${loan.payload.lender}`);

  const commandId = `cleanup-repay-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const body = JSON.stringify({
    commands: {
      userId: DAML_USER_ID,
      commandId,
      workflowId: '',
      commands: [{
        ExerciseCommand: {
          templateId: `${PACKAGE_ID}:ActiveLoanHybrid:ActiveLoanHybrid`,
          contractId: loan.contractId,
          choice: 'RepayHybrid',
          choiceArgument: { repaymentDate: today, repaymentAmount },
        },
      }],
      actAs: [loan.payload.borrower, loan.payload.lender],
      readAs: [],
      disclosedContracts: [],
      domainId: '',
      packageIdSelectionPreference: [],
    },
  });

  const res = await fetch(`${JSON_API_URL}/v2/commands/submit-and-wait-for-transaction`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body,
  });

  if (!res.ok) {
    throw new Error(`RepayHybrid failed (${res.status}): ${res.text()}`);
  }
  console.log(`  RepayHybrid succeeded`);
  return res.json();
}

async function unlockCC(token, ccRef) {
  console.log(`  Withdrawing CC collateral TransferOffer: ${ccRef}`);
  const res = await fetch(`${VALIDATOR_WALLET_URL}/api/validator/v0/wallet/transfer-offers/${ccRef}/withdraw`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: '{}',
  });
  if (!res.ok) {
    console.warn(`  CC unlock failed (${res.status}): ${res.text()} — may already be unlocked`);
  } else {
    console.log(`  CC collateral unlocked`);
  }
}

async function main() {
  console.log('Getting admin token...');
  const token = await getToken();

  console.log('Querying active loans...');
  const loans = await queryActiveLoans(token);
  console.log(`Found ${loans.length} active loan(s)`);

  if (loans.length === 0) {
    console.log('Nothing to clean up.');
    return;
  }

  for (const loan of loans) {
    console.log(`\nProcessing loan ${loan.contractId}`);
    console.log(`  borrower=${loan.payload.borrower}`);
    console.log(`  lender=${loan.payload.lender}`);
    console.log(`  principal=${loan.payload.principal}`);
    console.log(`  ccCollateralReference=${loan.payload.ccCollateralReference}`);

    try {
      await repayLoan(token, loan);
    } catch (err) {
      console.error(`  RepayHybrid error: ${err.message}`);
      console.log('  Skipping CC unlock due to RepayHybrid failure');
      continue;
    }

    await unlockCC(token, loan.payload.ccCollateralReference);
  }

  console.log('\nDone.');
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
