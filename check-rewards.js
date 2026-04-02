/**
 * Check app reward markers and coupons for the provider party.
 * Run: node check-rewards.js
 */

const https = require('https');
const http = require('http');

const AUTH0_TOKEN_URL = 'https://dev-6sfr03bu1tmm7q5e.us.auth0.com/oauth/token';
const AUTH0_CLIENT_ID = 'PUdptaRslnfyzkVUxzAVdOWNMMAmJnHt';
const AUTH0_CLIENT_SECRET = 'rb77mPzl1BvLFa51osRSUR4bGD_11xZRQgz0EUdIF-r-nV-QK6InGjdsrHcCT7sz';
const AUDIENCE = 'https://canton.network.global';

const JSON_API_URL = 'http://172.18.0.5:7575';
const DAML_USER_ID = 'PUdptaRslnfyzkVUxzAVdOWNMMAmJnHt@clients';
const PROVIDER_PARTY_ID = 'rhein-test-6559::12200868e62eb044f47552f943d03545973cd87fa0662a613d534d43f11a281e23c0';
const AMULET_PACKAGE_ID = '3ca1343ab26b453d38c8adb70dca5f1ead8440c42b59b68f070786955cbf9ec1';

// Interface IDs
const FEATURED_APP_MARKER_INTERFACE = '7804375fe5e4c6d5afe067bd314c42fe0b7d005a1300019c73154dd939da4dda:Splice.Api.FeaturedAppRightV1:FeaturedAppActivityMarker';
const APP_REWARD_COUPON_TEMPLATE = `${AMULET_PACKAGE_ID}:Splice.Amulet:AppRewardCoupon`;

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
      res.on('end', () => resolve({
        ok: res.statusCode >= 200 && res.statusCode < 300,
        status: res.statusCode,
        text: () => data,
        json: () => JSON.parse(data),
      }));
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
  return res.json().access_token;
}

async function getLedgerEnd(token) {
  const res = await fetch(`${JSON_API_URL}/v2/state/ledger-end`, { headers: { 'Authorization': `Bearer ${token}` } });
  return res.json().offset || 999999999;
}

async function queryByInterface(token, interfaceId, partyId) {
  const offset = await getLedgerEnd(token);
  const body = JSON.stringify({
    userId: DAML_USER_ID,
    filter: {
      filtersByParty: {
        [partyId]: {
          cumulative: [{
            identifierFilter: {
              InterfaceFilter: {
                value: { interfaceId, includeInterfaceView: true, includeCreatedEventBlob: false },
              },
            },
          }],
        },
      },
    },
    activeAtOffset: offset,
  });

  const res = await fetch(`${JSON_API_URL}/v2/state/active-contracts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body,
  });

  if (!res.ok) throw new Error(`Query failed (${res.status}): ${res.text()}`);
  const entries = res.json();
  return entries
    .map(e => e.contractEntry?.JsActiveContract?.createdEvent || e.createdEvent)
    .filter(e => e?.contractId);
}

async function queryByTemplate(token, templateId, partyId) {
  const offset = await getLedgerEnd(token);
  const body = JSON.stringify({
    userId: DAML_USER_ID,
    filter: {
      filtersByParty: {
        [partyId]: {
          cumulative: [{
            identifierFilter: {
              TemplateFilter: { value: { templateId, includeCreatedEventBlob: false } },
            },
          }],
        },
      },
    },
    activeAtOffset: offset,
  });

  const res = await fetch(`${JSON_API_URL}/v2/state/active-contracts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body,
  });

  if (!res.ok) throw new Error(`Query failed (${res.status}): ${res.text()}`);
  const entries = res.json();
  return entries
    .map(e => e.contractEntry?.JsActiveContract?.createdEvent || e.createdEvent)
    .filter(e => e?.contractId);
}

async function main() {
  console.log('Fetching token...');
  const token = await getToken();

  console.log(`\nProvider party: ${PROVIDER_PARTY_ID}\n`);

  // 1. Check pending activity markers (created by our DAML, not yet consumed by SV)
  console.log('=== FeaturedAppActivityMarker (pending, not yet consumed by Super Validator) ===');
  try {
    const markers = await queryByInterface(token, FEATURED_APP_MARKER_INTERFACE, PROVIDER_PARTY_ID);
    console.log(`Count: ${markers.length}`);
    for (const m of markers) {
      const view = m.interfaceViews?.[0]?.viewValue || m.createArgument;
      console.log(`  contractId: ${m.contractId}`);
      console.log(`  view: ${JSON.stringify(view)}`);
    }
    if (markers.length === 0) {
      console.log('  (none — either none created yet, or Super Validator already consumed them)');
    }
  } catch (err) {
    console.error(`  Error: ${err.message}`);
  }

  // 2. Check AppRewardCoupon contracts (created by SV after consuming markers)
  console.log('\n=== AppRewardCoupon (accumulated, not yet minted) ===');
  try {
    const coupons = await queryByTemplate(token, APP_REWARD_COUPON_TEMPLATE, PROVIDER_PARTY_ID);
    console.log(`Count: ${coupons.length}`);
    let totalWeight = 0;
    for (const c of coupons) {
      const args = c.createArgument;
      const weight = parseFloat(args?.weight || args?.amount || 0);
      totalWeight += weight;
      console.log(`  contractId: ${c.contractId.slice(0, 20)}...`);
      console.log(`  args: ${JSON.stringify(args)}`);
    }
    if (coupons.length > 0) {
      console.log(`  Total weight: ${totalWeight}`);
    } else {
      console.log('  (none — SV may not have processed markers yet, or coupons already minted)');
    }
  } catch (err) {
    console.error(`  Error: ${err.message}`);
  }
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
