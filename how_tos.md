Registry Utility - Retrieve Holdings API Example
This example shows how to retrieve holdings on CNU 0.9.x and later using the HTTP JSON API.

The example below retrieves all holdings of a user for a specific registrar, instrument, and minimum amount.

Prerequisites
A running validator node connected to one of DevNet, TestNet, or MainNet

The Utility DARs installed on your validator node

A valid business user token (<user-token>) obtained from the IAM of the validator node

A business user and associated party (<user-party>) created through the Validator API

The JSON API endpoint (<http-json-api>) of the participant node

curl and jq installed on your system

Preparation
Add all the required information to the source.sh file:

 1#!/usr/bin/env bash
 2
 3## =================================================================================================
 4## Purpose: Configurations for this example, amend variables as needed.
 5## Script: source.sh
 6## =================================================================================================
 7
 8# Users's details
 9USER_TOKEN="<PASTE_JWT_TOKEN_HERE>"
10USER_PARTY_ID="holder::1220d301ababbed7bc8d6f6a80ce16f33933a7274a3013241b7fb373ca7e4f0d6567"
11
12# Filtering criteria
13ADMIN_PARTY_ID="registrar::1220d301ababbed7bc8d6f6a80ce16f33933a7274a3013241b7fb373ca7e4f0d6567"
14INSTRUMENT_ID="INST"
15MIN_AMOUNT="5.0"
16
17# JSON API endpoint (pick one)
18# - Remote (TestNet/MainNet/other): HTTP_JSON_API="https://<your-host>/api/json-api"
19# - DevNet (example):               HTTP_JSON_API="https://utility.utility.cnu.devnet.da-int.net/api/json-api"
20# - Local (example):                HTTP_JSON_API="http://localhost:8001/api/json-api"
21HTTP_JSON_API="http://localhost:8001/api/json-api"
22
23# Token standard holding interface, may change when new versions of splice exists
24HOLDING_INTERFACE="718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b:Splice.Api.Token.HoldingV1:Holding"
25
26# Utility holding template, may change when a new version of the utility exists
27HOLDING_TEMPLATE="dd3a9f2d51cc4c52d9ec2e1d7ff235298dcfb3afd1d50ab44328b1aaa9a18587:Utility.Registry.Holding.V0.Holding:Holding"
The required information is:

Details of

Description

User

JWT, user ID, and party ID of the user

Registrar

Party ID of the registrar you want to query holdings for.

Instrument

The identifier of the specific instrument you want to query holdings for.

Minimum amount

The minimum amount for the holdings you want to query.


Retrieve Holdings
1. Obtain the Ledger End Offset
Run the following script to obtain the ledger end offset:

 1#!/usr/bin/env bash
 2
 3# obtain-ledger-offset.sh - Obtains the ledger end offset
 4
 5DATAFILE="source.sh"
 6source "$DATAFILE"
 7
 8OFFSET=$(curl -s GET \
 9    --url "${HTTP_JSON_API}/v2/state/ledger-end" \
10    --header "Accept: application/json" \
11    --header "Authorization: Bearer ${USER_TOKEN}")
12
13echo "$OFFSET" | jq
14
15OUTPUTFILE="response-obtain-ledger-offset.json"
16echo "$OFFSET" > "$OUTPUTFILE"
The result is the ledger end offset at this moment, stored in response-obtain-ledger-offset.json. For example:

1{
2  "offset": 4308
3}
2. Retrieve Utility Holdings
Run the following script to retrieve the Utility Holdings of the user, filtered by the specified instrument ID and minimum amount:

 1#!/usr/bin/env bash
 2
 3## =================================================================================================
 4## Purpose: Retrieves holdings of the user for a specific instrument and minimum amount
 5## Authorized by: User
 6## Script: retrieve-utility-holdings.sh
 7## =================================================================================================
 8
 9DATAFILE="source.sh"
10source "$DATAFILE"
11
12# Get offset from previous step
13if [[ -f "response-obtain-ledger-offset.json" ]]; then
14  JSONCONTENT=$(cat "response-obtain-ledger-offset.json")
15  OFFSET=$(echo "$JSONCONTENT" | jq -r ".offset")
16else
17  echo "Error: response-obtain-ledger-offset.json not found"
18  exit 1
19fi
20
21RESULT=$(curl -s \
22    --url "${HTTP_JSON_API}/v2/state/active-contracts" \
23    --header "Authorization: Bearer ${USER_TOKEN}" \
24    --header "Content-Type: application/json" \
25    --request POST \
26    --data @- <<EOF
27{
28    "verbose": false,
29    "activeAtOffset": "${OFFSET}",
30    "filter": {
31        "filtersByParty": {
32            "${USER_PARTY_ID}": {
33                "cumulative": [{
34                    "identifierFilter": {
35                        "TemplateFilter": {
36                            "value": {
37                                "templateId": "${HOLDING_TEMPLATE}",
38                                "includeCreatedEventBlob": false
39                            }
40                        }
41                    }
42                }]
43            }
44        }
45    }
46}
47EOF
48)
49
50# Filter holdings for a specific holder, instrument ID, admin, and minimum amount
51FILTERED=$(echo "$RESULT" | jq \
52  --arg USER_PARTY_ID "$USER_PARTY_ID" \
53  --arg INSTRUMENT_ID "$INSTRUMENT_ID" \
54  --arg ADMIN_PARTY_ID "$ADMIN_PARTY_ID" \
55  --arg MIN_AMOUNT "$MIN_AMOUNT" \
56  '[
57    .[]
58    | .contractEntry.JsActiveContract.createdEvent.createArgument
59    | select(
60        .registrar == $ADMIN_PARTY_ID and
61        .owner == $USER_PARTY_ID and
62        .instrument.id == $INSTRUMENT_ID and
63        .instrument.source == $ADMIN_PARTY_ID and
64        (.amount | tonumber) >= ($MIN_AMOUNT | tonumber)
65    )
66  ]'
67)
68
69echo "--- All utility holdings of ${USER_PARTY_ID} with amount>=${MIN_AMOUNT} as of offset ${OFFSET} ---"
70echo "$FILTERED" | jq
71
72OUTPUTFILE="response-retrieve-utility-holdings.json"
73echo "$FILTERED" > "$OUTPUTFILE"
The result is the Holding Cids, stored in response-retrieve-utility-holdings.json. For example:

 1[
 2  {
 3    "operator": "operator::1220b39df5ed0e3c584cd97e86e779def933d545bf9a4fab3c0fd3e4ad3f7a36b8fe",
 4    "provider": "provider::1220d301ababbed7bc8d6f6a80ce16f33933a7274a3013241b7fb373ca7e4f0d6567",
 5    "registrar": "registrar::1220d301ababbed7bc8d6f6a80ce16f33933a7274a3013241b7fb373ca7e4f0d6567",
 6    "owner": "holder::1220d301ababbed7bc8d6f6a80ce16f33933a7274a3013241b7fb373ca7e4f0d6567",
 7    "instrument": {
 8      "source": "registrar::1220d301ababbed7bc8d6f6a80ce16f33933a7274a3013241b7fb373ca7e4f0d6567",
 9      "id": "INST",
10      "scheme": "RegistrarInternalScheme"
11    },
12    "label": "",
13    "amount": "10.0000000000"
14  }
15]
3. Retrieve Canton Network Token Standard Holdings
Run the following script to retrieve the Canton Network Token Standard Holdings of the user, filtered by the specified instrument ID and minimum amount:

 1#!/usr/bin/env bash
 2
 3## =================================================================================================
 4## Purpose: Retrieves holdings of the user for a specific instrument and minimum amount
 5## Authorized by: User
 6## Script: retrieve-holdings.sh
 7## =================================================================================================
 8
 9DATAFILE="source.sh"
10source "$DATAFILE"
11
12# Get offset from previous step
13if [[ -f "response-obtain-ledger-offset.json" ]]; then
14  JSONCONTENT=$(cat "response-obtain-ledger-offset.json")
15  OFFSET=$(echo "$JSONCONTENT" | jq -r ".offset")
16else
17  echo "Error: response-obtain-ledger-offset.json not found"
18  exit 1
19fi
20
21RESULT=$(curl -s \
22    --url "${HTTP_JSON_API}/v2/state/active-contracts" \
23    --header "Authorization: Bearer ${USER_TOKEN}" \
24    --header "Content-Type: application/json" \
25    --request POST \
26    --data @- <<EOF
27{
28    "verbose": false,
29    "activeAtOffset": "${OFFSET}",
30    "filter": {
31        "filtersByParty": {
32            "${USER_PARTY_ID}": {
33                "cumulative": [{
34                    "identifierFilter": {
35                        "InterfaceFilter": {
36                            "value": {
37                                "interfaceId":"$HOLDING_INTERFACE",
38                                "includeInterfaceView": true,
39                                "includeCreatedEventBlob": false
40                            }
41                        }
42                    }
43                }]
44            }
45        }
46    }
47}
48EOF
49)
50
51# Filter holdings for a specific holder, instrument ID, admin, and minimum amount
52FILTERED=$(echo "$RESULT" | jq \
53  --arg USER_PARTY_ID "$USER_PARTY_ID" \
54  --arg INSTRUMENT_ID "$INSTRUMENT_ID" \
55  --arg ADMIN_PARTY_ID "$ADMIN_PARTY_ID" \
56  --arg MIN_AMOUNT "$MIN_AMOUNT" \
57  '[
58    .[]
59    | .contractEntry.JsActiveContract.createdEvent.interfaceViews[]
60    | select(
61        .viewValue.owner == $USER_PARTY_ID and
62        .viewValue.instrumentId.id == $INSTRUMENT_ID and
63        .viewValue.instrumentId.admin == $ADMIN_PARTY_ID and
64        (.viewValue.amount | tonumber) > ($MIN_AMOUNT | tonumber)
65    )
66  ]'
67)
68
69echo "--- All interface holdings of ${USER_PARTY_ID} with amount>=${MIN_AMOUNT} as of offset ${OFFSET} ---"
70echo "$FILTERED" | jq
71
72OUTPUTFILE="response-retrieve-holdings.json"
73echo "$FILTERED" > "$OUTPUTFILE"
The result is the Holding Cids, stored in response-retrieve-holdings.json. For example:

 1[
 2  {
 3    "interfaceId": "718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b:Splice.Api.Token.HoldingV1:Holding",
 4    "viewStatus": {
 5      "code": 0,
 6      "message": "",
 7      "details": []
 8    },
 9    "viewValue": {
10      "owner": "holder::1220d301ababbed7bc8d6f6a80ce16f33933a7274a3013241b7fb373ca7e4f0d6567",
11      "instrumentId": {
12        "admin": "registrar::1220d301ababbed7bc8d6f6a80ce16f33933a7274a3013241b7fb373ca7e4f0d6567",
13        "id": "INST"
14      },
15      "amount": "10.0000000000",
16      "lock": null,
17      "meta": {
18        "values": {
19          "utility.digitalasset.com/holding-label": ""
20        }
21      }
22    }
23  }
24]






---------------------------------------

Registry Utility - Transfer API Example
This example shows how to perform a transfer offer on CNU 0.9.x and later using the HTTP JSON API.

It is assumed that both the sender and receiver have all the required credentials as holders of the specific instrument.

Preparation
Add all the required information to the source.sh file:

 1#!/usr/bin/env bash
 2
 3## =================================================================================================
 4## Purpose: Configurations for this example, amend variables as needed.
 5## Script: source.sh
 6## =================================================================================================
 7
 8# Sender's details
 9SENDER_TOKEN="<PASTE_JWT_TOKEN_HERE>"
10SENDER_PARTY_ID="issuer::1220d301ababbed7bc8d6f6a80ce16f33933a7274a3013241b7fb373ca7e4f0d6567"
11SENDER_USER_ID="issuer"
12
13# Receiver's details
14RECEIVER_TOKEN="<PASTE_JWT_TOKEN_HERE>"
15RECEIVER_PARTY_ID="holder::1220d301ababbed7bc8d6f6a80ce16f33933a7274a3013241b7fb373ca7e4f0d6567"
16RECEIVER_USER_ID="holder"
17
18# Update your asset and amount to be transferred
19ADMIN_PARTY_ID="registrar::1220d301ababbed7bc8d6f6a80ce16f33933a7274a3013241b7fb373ca7e4f0d6567"
20ASSET_ID="INST"
21ASSET_AMOUNT="10.0"
22
23# Endpoints (pick one)
24# - Remote: BACKEND_API="https://<your-host>/api/utilities" HTTP_JSON_API="https://<your-host>/api/json-api"
25# - DevNet: BACKEND_API="https://api.utilities.digitalasset-dev.com/api/utilities" HTTP_JSON_API="https://utility.utility.cnu.devnet.da-int.net/api/json-api"
26# - Local:  BACKEND_API="http://localhost:8080/api/utilities" HTTP_JSON_API="http://localhost:8001/api/json-api"
27BACKEND_API="http://localhost:8080/api/utilities"
28HTTP_JSON_API="http://localhost:8001/api/json-api"
29
30# Token standard holding interface, may change when new versions of splice exists
31TRANSFERFACTORY_INTERFACE="55ba4deb0ad4662c4168b39859738a0e91388d252286480c7331b3f71a517281:Splice.Api.Token.TransferInstructionV1:TransferFactory"
32HOLDING_INTERFACE="718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b:Splice.Api.Token.HoldingV1:Holding"
33TRANSFER_INSTRUCTION_INTERFACE="55ba4deb0ad4662c4168b39859738a0e91388d252286480c7331b3f71a517281:Splice.Api.Token.TransferInstructionV1:TransferInstruction"
The required information is:

Details of

Description

Sender

JWT, user ID, and party ID of the sender

Receiver

JWT, user ID, and party ID of the receiver

Operator

Backend API and JSON Ledger API

Transfer

Instrument ID and amount to be transferred


If possible, open three CNU UI windows, one each for the admin, sender, and receiver. This allows you to observe changes in holdings for the parties throughout the transfer process. The image below shows the initial holdings for both the sender (issuer) and the receiver (holder) for the instrument INST.

Initial positions
Step 1: Sender Offers a Transfer
Step 1a - Obtain the Ledger End Offset
Run the following script to obtain the ledger end offset:

 1#!/usr/bin/env bash
 2
 3## =================================================================================================
 4## Sender offers a transfer
 5## Step 1a: Obtains ledger end offset
 6## Authorized by: Sender
 7## Script: step-1a-sender-offers.sh
 8## =================================================================================================
 9
10DATAFILE="source.sh"
11source "$DATAFILE"
12
13OFFSET=$(curl -s GET \
14    --url "${HTTP_JSON_API}/v2/state/ledger-end" \
15    --header "Accept: application/json" \
16    --header "Authorization: Bearer ${SENDER_TOKEN}")
17
18echo "$OFFSET" | jq
19
20OUTPUTFILE="response-step-1a.json"
21echo "$OFFSET" > "$OUTPUTFILE"
The result is the ledger end offset at this moment, stored in response-step-1a.json. For example:

1{
2  "offset": 4246
3}
Step 1b - Retrieve Holding Cids
Run the following script to retrieve the Holding Cids:

 1#!/usr/bin/env bash
 2
 3## =================================================================================================
 4## Sender offers a transfer
 5## Step 1b: Retrieve sender's holdings as of the offset from step 1a to use for the transfer
 6## Authorized by: Sender
 7## Script: step-1b-sender-offers.sh
 8## =================================================================================================
 9
10DATAFILE="source.sh"
11source "$DATAFILE"
12
13# Get offset from previous step
14if [[ -f "response-step-1a.json" ]]; then
15  JSONCONTENT=$(cat "response-step-1a.json")
16  OFFSET=$(echo "$JSONCONTENT" | jq -r ".offset")
17else
18  echo "Error: response-step-1a.json not found"
19  exit 1
20fi
21
22RESULT=$(
23    curl -s \
24    --url "${HTTP_JSON_API}/v2/state/active-contracts" \
25    --header "Authorization: Bearer ${SENDER_TOKEN}" \
26    --header "Content-Type: application/json" \
27    --request POST \
28    --data @- <<EOF
29{
30    "verbose": false,
31    "activeAtOffset": "${OFFSET}",
32    "filter": {
33        "filtersByParty": {
34            "${SENDER_PARTY_ID}": {
35                "cumulative": [{
36                    "identifierFilter": {
37                        "InterfaceFilter": {
38                            "value": {
39                                "interfaceId":"$HOLDING_INTERFACE",
40                                "includeInterfaceView": true,
41                                "includeCreatedEventBlob": false
42                            }
43                        }
44                    }
45                }]
46            }
47        }
48    }
49}
50EOF
51)
52
53
54# Filter holdings for a specific holder, instrument ID, admin and extract contractId
55HOLDINGCIDS=$(echo "$RESULT" | jq \
56  --arg SENDER_PARTY_ID "$SENDER_PARTY_ID" \
57  --arg ASSET_ID "$ASSET_ID" \
58  --arg ADMIN_PARTY_ID "$ADMIN_PARTY_ID" \
59  '[
60    .[] as $c
61    | $c.contractEntry.JsActiveContract.createdEvent.interfaceViews[]
62    | select(
63        .viewValue.owner == $SENDER_PARTY_ID and
64        .viewValue.instrumentId.id == $ASSET_ID and
65        .viewValue.instrumentId.admin == $ADMIN_PARTY_ID
66    )
67    | $c.contractEntry.JsActiveContract.createdEvent.contractId
68  ]'
69)
70
71echo "--- Holdings of sender (${SENDER_USER_ID}) as of offset ${OFFSET} ---"
72echo "$HOLDINGCIDS" | jq
73
74OUTPUTFILE="response-step-1b.json"
75echo "$HOLDINGCIDS" > "$OUTPUTFILE"
The result is the Holding Cids, stored in response-step-1b.json. For example:

1[
2  "0016ddecdd744c90c7d25fd9609369223c44337fb73dba5c63613c14f9f4e1e44eca111220c8227ae252e5767438faccd649c077c907e394ed476a7129b2af48ff9a242049",
3  "00d37133155054a7a4788c59d2f318bea3a78ab046cf1cb5e437774668b48a6f4bca11122072d862fa4cac490a05de4fedc8a3f421ed399ce0fe4a6e85155cdf5988c35dbf"
4]
Step 1c - Access the Backend API
The request URL is ${BACKEND_API}/v0/registrars/${ADMIN_PARTY_ID}/registry/transfer-instruction/v1/transfer-factory. To hit this endpoint, run the following script:

 1#!/usr/bin/env bash
 2
 3## =================================================================================================
 4## Sender offers a transfer
 5## Step 1c: Gets choice context and disclosure for the transfer-offer command
 6## Authorized by: anyone
 7## Script: step-1c-sender-offers.sh
 8## =================================================================================================
 9
10DATAFILE="source.sh"
11source "$DATAFILE"
12
13DATE_FORMAT='+%Y-%m-%dT%H:%M:%SZ'
14NOW_ISO_TIMESTAMP=$(date -u "$DATE_FORMAT")
15ONEHOUR_ISO_TIMESTAMP=$(date -u -d '+1 hour' "$DATE_FORMAT")
16
17HOLDINGCIDS=$(cat "response-step-1b.json")
18
19RESULT=$(
20    curl -s \
21    --url "${BACKEND_API}/v0/registrars/${ADMIN_PARTY_ID}/registry/transfer-instruction/v1/transfer-factory" \
22    --header "Content-Type: application/json" \
23    --request POST \
24    --data @- <<EOF
25{
26   "choiceArguments":{
27      "expectedAdmin":"${ADMIN_PARTY_ID}",
28      "transfer":{
29         "sender":"${SENDER_PARTY_ID}",
30         "receiver":"${RECEIVER_PARTY_ID}",
31         "amount":"${ASSET_AMOUNT}",
32         "instrumentId":{
33            "admin":"${ADMIN_PARTY_ID}",
34            "id":"${ASSET_ID}"
35         },
36         "requestedAt":"${NOW_ISO_TIMESTAMP}",
37         "executeBefore":"${ONEHOUR_ISO_TIMESTAMP}",
38         "inputHoldingCids":${HOLDINGCIDS},
39         "meta":{
40            "values":{
41               "splice.lfdecentralizedtrust.org/reason":""
42            }
43         }
44      },
45      "extraArgs":{
46         "context":{
47            "values":{
48
49            }
50         },
51         "meta":{
52            "values":{
53
54            }
55         }
56      }
57   },
58   "excludeDebugFields":true
59}
60EOF
61)
62
63echo "--- Endpoint response ---"
64echo $RESULT | jq
65
66OUTPUTFILE="response-step-1c.json"
67echo "$RESULT" > "$OUTPUTFILE"
The result contains the required choice context for executing the command, stored in response-step-1c.json. For example:

 1{
 2  "factoryId": "000b99a12b36d9d3b865060c19eab4558b63b105ea8f6917442aef10394712ee7dca1112205046662015ee57e20143d8ae8f9985e069d1db31e3d8540c0543f3e4ccb8e863",
 3  "transferKind": "offer",
 4  "choiceContext": {
 5    "choiceContextData": {
 6      "values": {
 7        "utility.digitalasset.com/instrument-configuration": {
 8          "tag": "AV_ContractId",
 9          "value": "00eca75bf1e14e192de69b58054cf62f2a60a9c0aae8f4d3491a4b2fad9f9731eaca111220b5fd51ccd498385b0ceaef63243fdfef6c2e62dd8d3a2f59fdb61a9099956481"
10        },
11        "utility.digitalasset.com/sender-credentials": {
12          "tag": "AV_List",
13          "value": [
14            {
15              "tag": "AV_ContractId",
16              "value": "00840216df4df7f46e853231f4cfcd23dfb98bc4a3d670b1e0ed3b9b9afa218aecca1112207057c74dc0da345b4ec3006eae3a55ac1cd7fc34aa23c13cf453f5b9a9884235"
17            }
18          ]
19        },
20        "instrument-configuration": {
21          "tag": "AV_ContractId",
22          "value": "00eca75bf1e14e192de69b58054cf62f2a60a9c0aae8f4d3491a4b2fad9f9731eaca111220b5fd51ccd498385b0ceaef63243fdfef6c2e62dd8d3a2f59fdb61a9099956481"
23        },
24        "sender-credentials": {
25          "tag": "AV_List",
26          "value": [
27            {
28              "tag": "AV_ContractId",
29              "value": "00840216df4df7f46e853231f4cfcd23dfb98bc4a3d670b1e0ed3b9b9afa218aecca1112207057c74dc0da345b4ec3006eae3a55ac1cd7fc34aa23c13cf453f5b9a9884235"
30            }
31          ]
32        }
33      }
34    },
35    "disclosedContracts": [
36      {
37        "templateId": "170929b11d5f0ed1385f890f42887c31ff7e289c0f4bc482aff193a7173d576c:Utility.Registry.App.V0.Service.AllocationFactory:AllocationFactory",
38        "contractId": "000b99a12b36d9d3b865060c19eab4558b63b105ea8f6917442aef10394712ee7dca1112205046662015ee57e20143d8ae8f9985e069d1db31e3d8540c0543f3e4ccb8e863",
39        "createdEventBlob": "CgMyLjESmQYKRQALmaErNtnTuGUGDBnqtFWLY7EF6o9pF0Qq7xA5RxLufcoREiBQRmYgFe5X4gFD2K6PmYXgadHbMePYVAwFQ/PkzLjoYxIXdXRpbGl0eS1yZWdpc3RyeS1hcHAtdjAajQEKQDE3MDkyOWIxMWQ1ZjBlZDEzODVmODkwZjQyODg3YzMxZmY3ZTI4OWMwZjRiYzQ4MmFmZjE5M2E3MTczZDU3NmMSB1V0aWxpdHkSCFJlZ2lzdHJ5EgNBcHASAlYwEgdTZXJ2aWNlEhFBbGxvY2F0aW9uRmFjdG9yeRoRQWxsb2NhdGlvbkZhY3RvcnkigAJq/QEKUgpQOk5wcm92aWRlcjo6MTIyMGQzMDFhYmFiYmVkN2JjOGQ2ZjZhODBjZTE2ZjMzOTMzYTcyNzRhMzAxMzI0MWI3ZmIzNzNjYTdlNGYwZDY1NjcKUwpROk9yZWdpc3RyYXI6OjEyMjBkMzAxYWJhYmJlZDdiYzhkNmY2YTgwY2UxNmYzMzkzM2E3Mjc0YTMwMTMyNDFiN2ZiMzczY2E3ZTRmMGQ2NTY3ClIKUDpOb3BlcmF0b3I6OjEyMjBiMzlkZjVlZDBlM2M1ODRjZDk3ZTg2ZTc3OWRlZjkzM2Q1NDViZjlhNGZhYjNjMGZkM2U0YWQzZjdhMzZiOGZlKk5wcm92aWRlcjo6MTIyMGQzMDFhYmFiYmVkN2JjOGQ2ZjZhODBjZTE2ZjMzOTMzYTcyNzRhMzAxMzI0MWI3ZmIzNzNjYTdlNGYwZDY1NjcqT3JlZ2lzdHJhcjo6MTIyMGQzMDFhYmFiYmVkN2JjOGQ2ZjZhODBjZTE2ZjMzOTMzYTcyNzRhMzAxMzI0MWI3ZmIzNzNjYTdlNGYwZDY1NjcyTm9wZXJhdG9yOjoxMjIwYjM5ZGY1ZWQwZTNjNTg0Y2Q5N2U4NmU3NzlkZWY5MzNkNTQ1YmY5YTRmYWIzYzBmZDNlNGFkM2Y3YTM2YjhmZTnKhnS2q0AGAEIqCiYKJAgBEiCdfF/uuVvbYVGCBftUb6P/SwJDPzwGmCDQ4jzAdtOMPBAe",
40        "synchronizerId": "",
41        "debugPackageName": null,
42        "debugPayload": null,
43        "debugCreatedAt": null
44      },
45      {
46        "templateId": "ed73d5b9ab717333f3dbd122de7be3156f8bf2614a67360c3dd61fc0135133fa:Utility.Registry.V0.Configuration.Instrument:InstrumentConfiguration",
47        "contractId": "00eca75bf1e14e192de69b58054cf62f2a60a9c0aae8f4d3491a4b2fad9f9731eaca111220b5fd51ccd498385b0ceaef63243fdfef6c2e62dd8d3a2f59fdb61a9099956481",
48        "createdEventBlob": "CgMyLjESpgkKRQDsp1vx4U4ZLeabWAVM9i8qYKnAquj000kaSy+tn5cx6soREiC1/VHM1Jg4Wwzq72MkP9/vbC5i3Y06L1n9thqQmZVkgRITdXRpbGl0eS1yZWdpc3RyeS12MBqNAQpAZWQ3M2Q1YjlhYjcxNzMzM2YzZGJkMTIyZGU3YmUzMTU2ZjhiZjI2MTRhNjczNjBjM2RkNjFmYzAxMzUxMzNmYRIHVXRpbGl0eRIIUmVnaXN0cnkSAlYwEg1Db25maWd1cmF0aW9uEgpJbnN0cnVtZW50GhdJbnN0cnVtZW50Q29uZmlndXJhdGlvbiKRBWqOBQpSClA6Tm9wZXJhdG9yOjoxMjIwYjM5ZGY1ZWQwZTNjNTg0Y2Q5N2U4NmU3NzlkZWY5MzNkNTQ1YmY5YTRmYWIzYzBmZDNlNGFkM2Y3YTM2YjhmZQpSClA6TnByb3ZpZGVyOjoxMjIwZDMwMWFiYWJiZWQ3YmM4ZDZmNmE4MGNlMTZmMzM5MzNhNzI3NGEzMDEzMjQxYjdmYjM3M2NhN2U0ZjBkNjU2NwpTClE6T3JlZ2lzdHJhcjo6MTIyMGQzMDFhYmFiYmVkN2JjOGQ2ZjZhODBjZTE2ZjMzOTMzYTcyNzRhMzAxMzI0MWI3ZmIzNzNjYTdlNGYwZDY1NjcKgAEKfmp8ClMKUTpPcmVnaXN0cmFyOjoxMjIwZDMwMWFiYWJiZWQ3YmM4ZDZmNmE4MGNlMTZmMzM5MzNhNzI3NGEzMDEzMjQxYjdmYjM3M2NhN2U0ZjBkNjU2NwoICgZCBElOU1QKGwoZQhdSZWdpc3RyYXJJbnRlcm5hbFNjaGVtZQoECgJaAAqBAQp/Wn0Ke2p5ClMKUTpPcmVnaXN0cmFyOjoxMjIwZDMwMWFiYWJiZWQ3YmM4ZDZmNmE4MGNlMTZmMzM5MzNhNzI3NGEzMDEzMjQxYjdmYjM3M2NhN2U0ZjBkNjU2NwoiCiBaHgocahoKDgoMQgppc0lzc3Vlck9mCggKBkIESU5TVAqBAQp/Wn0Ke2p5ClMKUTpPcmVnaXN0cmFyOjoxMjIwZDMwMWFiYWJiZWQ3YmM4ZDZmNmE4MGNlMTZmMzM5MzNhNzI3NGEzMDEzMjQxYjdmYjM3M2NhN2U0ZjBkNjU2NwoiCiBaHgocahoKDgoMQgppc0hvbGRlck9mCggKBkIESU5TVCpOcHJvdmlkZXI6OjEyMjBkMzAxYWJhYmJlZDdiYzhkNmY2YTgwY2UxNmYzMzkzM2E3Mjc0YTMwMTMyNDFiN2ZiMzczY2E3ZTRmMGQ2NTY3Kk9yZWdpc3RyYXI6OjEyMjBkMzAxYWJhYmJlZDdiYzhkNmY2YTgwY2UxNmYzMzkzM2E3Mjc0YTMwMTMyNDFiN2ZiMzczY2E3ZTRmMGQ2NTY3Mk5vcGVyYXRvcjo6MTIyMGIzOWRmNWVkMGUzYzU4NGNkOTdlODZlNzc5ZGVmOTMzZDU0NWJmOWE0ZmFiM2MwZmQzZTRhZDNmN2EzNmI4ZmU5rPtttqtABgBCKgomCiQIARIgQ1DsOZLYGVRiscestTBDQ3CqU27WvKQODudfxMesKCEQHg==",
49        "synchronizerId": "",
50        "debugPackageName": null,
51        "debugPayload": null,
52        "debugCreatedAt": null
53      }
54    ]
55  }
56}
Step 1d - Offer the Transfer
Finally, run the following script to offer the transfer:

 1#!/usr/bin/env bash
 2
 3## =================================================================================================
 4## Sender offers a transfer
 5## Step 1d: Executes the transfer-offer command
 6## Authorized by: Sender
 7## Script: step-1d-sender-offers.sh
 8## =================================================================================================
 9
10DATAFILE="source.sh"
11source "$DATAFILE"
12
13DATE_FORMAT='+%Y-%m-%dT%H:%M:%SZ'
14NOW_ISO_TIMESTAMP=$(date -u "$DATE_FORMAT")
15ONEHOUR_ISO_TIMESTAMP=$(date -u -d '+1 hour' "$DATE_FORMAT")
16
17HOLDINGCIDS=$(cat "response-step-1b.json")
18
19JSONCONTENT=$(cat "response-step-1c.json")
20FACTORYID=$(echo $JSONCONTENT | jq .factoryId)
21CHOICECONTEXTDATA=$(echo $JSONCONTENT | jq .choiceContext.choiceContextData)
22DISCLOSEDCONTRACTS=$(echo $JSONCONTENT | jq .choiceContext.disclosedContracts)
23
24RESULT=$(
25    curl -s \
26    --url "${HTTP_JSON_API}/v2/commands/submit-and-wait-for-transaction" \
27    --header "Authorization: Bearer ${SENDER_TOKEN}" \
28    --header "Content-Type: application/json" \
29    --request POST \
30    --data @- <<EOF
31{
32   "commands":{
33        "commands":[
34            {
35                "ExerciseCommand":{
36                    "templateId":"${TRANSFERFACTORY_INTERFACE}",
37                    "contractId":${FACTORYID},
38                    "choice":"TransferFactory_Transfer",
39                    "choiceArgument":{
40                        "expectedAdmin":"${ADMIN_PARTY_ID}",
41                        "transfer":{
42                            "sender":"${SENDER_PARTY_ID}",
43                            "receiver":"${RECEIVER_PARTY_ID}",
44                            "amount":"${ASSET_AMOUNT}",
45                            "instrumentId":{
46                                "admin":"${ADMIN_PARTY_ID}",
47                                "id":"${ASSET_ID}"
48                            },
49                            "requestedAt":"${NOW_ISO_TIMESTAMP}",
50                            "executeBefore":"${ONEHOUR_ISO_TIMESTAMP}",
51                            "inputHoldingCids":${HOLDINGCIDS},
52                            "meta":{
53                                "values":{
54                                    "splice.lfdecentralizedtrust.org/reason":""
55                                }
56                            }
57                        },
58                        "extraArgs":{
59                            "context":${CHOICECONTEXTDATA},
60                            "meta":{
61                                "values":{
62                                }
63                            }
64                        }
65                    }
66                }
67            }
68        ],
69        "workflowId":"",
70        "userId":"${SENDER_USER_ID}",
71        "commandId":"$(uuidgen | tr -d '\n')",
72        "deduplicationPeriod":{
73            "DeduplicationDuration":{
74                "value":{
75                    "seconds":30,
76                    "nanos":0
77                }
78            }
79        },
80        "actAs":[
81            "${SENDER_PARTY_ID}"
82        ],
83        "readAs":[
84
85        ],
86        "submissionId":"$(uuidgen | tr -d '\n')",
87        "disclosedContracts": ${DISCLOSEDCONTRACTS},
88        "domainId":"",
89        "packageIdSelectionPreference":[]
90    }
91}
92EOF
93)
94
95echo "--- Command response ---"
96echo $RESULT | jq
97
98OUTPUTFILE="response-step-1d.json"
99echo "$RESULT" > "$OUTPUTFILE"
For example, this is the response of this command:

  1{
  2  "transaction": {
  3    "updateId": "1220c6b7f0a55d77b5a1634c322fa2e63bed70814d25c89ee1d07d719473a3208676",
  4    "commandId": "E13861F6-F6E0-4802-B9DB-F4B70E1048BF",
  5    "workflowId": "",
  6    "effectiveAt": "2025-10-10T10:31:55.117218Z",
  7    "events": [
  8      {
  9        "ArchivedEvent": {
 10          "offset": 4249,
 11          "nodeId": 4,
 12          "contractId": "0016ddecdd744c90c7d25fd9609369223c44337fb73dba5c63613c14f9f4e1e44eca111220c8227ae252e5767438faccd649c077c907e394ed476a7129b2af48ff9a242049",
 13          "templateId": "dd3a9f2d51cc4c52d9ec2e1d7ff235298dcfb3afd1d50ab44328b1aaa9a18587:Utility.Registry.Holding.V0.Holding:Holding",
 14          "witnessParties": [
 15            "issuer::1220d301ababbed7bc8d6f6a80ce16f33933a7274a3013241b7fb373ca7e4f0d6567"
 16          ],
 17          "packageName": "utility-registry-holding-v0",
 18          "implementedInterfaces": []
 19        }
 20      },
 21      {
 22        "ArchivedEvent": {
 23          "offset": 4249,
 24          "nodeId": 6,
 25          "contractId": "00d37133155054a7a4788c59d2f318bea3a78ab046cf1cb5e437774668b48a6f4bca11122072d862fa4cac490a05de4fedc8a3f421ed399ce0fe4a6e85155cdf5988c35dbf",
 26          "templateId": "dd3a9f2d51cc4c52d9ec2e1d7ff235298dcfb3afd1d50ab44328b1aaa9a18587:Utility.Registry.Holding.V0.Holding:Holding",
 27          "witnessParties": [
 28            "issuer::1220d301ababbed7bc8d6f6a80ce16f33933a7274a3013241b7fb373ca7e4f0d6567"
 29          ],
 30          "packageName": "utility-registry-holding-v0",
 31          "implementedInterfaces": []
 32        }
 33      },
 34      {
 35        "CreatedEvent": {
 36          "offset": 4249,
 37          "nodeId": 7,
 38          "contractId": "0041f93610a76b343fe5e969b953805a23674304341ff36a8e61fa1df0be6fc7f3ca111220877889786a97380f80e2a00e0da81525833982d789c9d72dc43ddc24d215eecb",
 39          "templateId": "dd3a9f2d51cc4c52d9ec2e1d7ff235298dcfb3afd1d50ab44328b1aaa9a18587:Utility.Registry.Holding.V0.Holding:Holding",
 40          "contractKey": null,
 41          "createArgument": {
 42            "operator": "operator::1220b39df5ed0e3c584cd97e86e779def933d545bf9a4fab3c0fd3e4ad3f7a36b8fe",
 43            "provider": "provider::1220d301ababbed7bc8d6f6a80ce16f33933a7274a3013241b7fb373ca7e4f0d6567",
 44            "registrar": "registrar::1220d301ababbed7bc8d6f6a80ce16f33933a7274a3013241b7fb373ca7e4f0d6567",
 45            "owner": "issuer::1220d301ababbed7bc8d6f6a80ce16f33933a7274a3013241b7fb373ca7e4f0d6567",
 46            "instrument": {
 47              "source": "registrar::1220d301ababbed7bc8d6f6a80ce16f33933a7274a3013241b7fb373ca7e4f0d6567",
 48              "id": "INST",
 49              "scheme": "RegistrarInternalScheme"
 50            },
 51            "label": "",
 52            "amount": "10.0000000000",
 53            "lock": {
 54              "lockers": {
 55                "map": [
 56                  [
 57                    "registrar::1220d301ababbed7bc8d6f6a80ce16f33933a7274a3013241b7fb373ca7e4f0d6567",
 58                    {}
 59                  ]
 60                ]
 61              },
 62              "context": "",
 63              "observers": {
 64                "map": [
 65                  [
 66                    "holder::1220d301ababbed7bc8d6f6a80ce16f33933a7274a3013241b7fb373ca7e4f0d6567",
 67                    {}
 68                  ]
 69                ]
 70              }
 71            }
 72          },
 73          "createdEventBlob": "",
 74          "interfaceViews": [],
 75          "witnessParties": [
 76            "issuer::1220d301ababbed7bc8d6f6a80ce16f33933a7274a3013241b7fb373ca7e4f0d6567"
 77          ],
 78          "signatories": [
 79            "issuer::1220d301ababbed7bc8d6f6a80ce16f33933a7274a3013241b7fb373ca7e4f0d6567",
 80            "registrar::1220d301ababbed7bc8d6f6a80ce16f33933a7274a3013241b7fb373ca7e4f0d6567"
 81          ],
 82          "observers": [
 83            "holder::1220d301ababbed7bc8d6f6a80ce16f33933a7274a3013241b7fb373ca7e4f0d6567",
 84            "operator::1220b39df5ed0e3c584cd97e86e779def933d545bf9a4fab3c0fd3e4ad3f7a36b8fe",
 85            "provider::1220d301ababbed7bc8d6f6a80ce16f33933a7274a3013241b7fb373ca7e4f0d6567"
 86          ],
 87          "createdAt": "2025-10-10T10:31:55.117218Z",
 88          "packageName": "utility-registry-holding-v0"
 89        }
 90      },
 91      {
 92        "CreatedEvent": {
 93          "offset": 4249,
 94          "nodeId": 8,
 95          "contractId": "00c5ebf11bba0ef8c43531a83906453997253ed8493334cabc0852e057e01d849dca111220b95fcfdcd054ab8f88a0196f3129651facd8c6f1103db092824a1f857ffd53f5",
 96          "templateId": "dd3a9f2d51cc4c52d9ec2e1d7ff235298dcfb3afd1d50ab44328b1aaa9a18587:Utility.Registry.Holding.V0.Holding:Holding",
 97          "contractKey": null,
 98          "createArgument": {
 99            "operator": "operator::1220b39df5ed0e3c584cd97e86e779def933d545bf9a4fab3c0fd3e4ad3f7a36b8fe",
100            "provider": "provider::1220d301ababbed7bc8d6f6a80ce16f33933a7274a3013241b7fb373ca7e4f0d6567",
101            "registrar": "registrar::1220d301ababbed7bc8d6f6a80ce16f33933a7274a3013241b7fb373ca7e4f0d6567",
102            "owner": "issuer::1220d301ababbed7bc8d6f6a80ce16f33933a7274a3013241b7fb373ca7e4f0d6567",
103            "instrument": {
104              "source": "registrar::1220d301ababbed7bc8d6f6a80ce16f33933a7274a3013241b7fb373ca7e4f0d6567",
105              "id": "INST",
106              "scheme": "RegistrarInternalScheme"
107            },
108            "label": "",
109            "amount": "30.0000000000",
110            "lock": null
111          },
112          "createdEventBlob": "",
113          "interfaceViews": [],
114          "witnessParties": [
115            "issuer::1220d301ababbed7bc8d6f6a80ce16f33933a7274a3013241b7fb373ca7e4f0d6567"
116          ],
117          "signatories": [
118            "issuer::1220d301ababbed7bc8d6f6a80ce16f33933a7274a3013241b7fb373ca7e4f0d6567",
119            "registrar::1220d301ababbed7bc8d6f6a80ce16f33933a7274a3013241b7fb373ca7e4f0d6567"
120          ],
121          "observers": [
122            "operator::1220b39df5ed0e3c584cd97e86e779def933d545bf9a4fab3c0fd3e4ad3f7a36b8fe",
123            "provider::1220d301ababbed7bc8d6f6a80ce16f33933a7274a3013241b7fb373ca7e4f0d6567"
124          ],
125          "createdAt": "2025-10-10T10:31:55.117218Z",
126          "packageName": "utility-registry-holding-v0"
127        }
128      },
129      {
130        "CreatedEvent": {
131          "offset": 4249,
132          "nodeId": 9,
133          "contractId": "00faddf948ee97e0d70be1baad6517e8af6a1bbd57e0646c300e2d23857bacb38fca11122059a0b3f54bafc2deab11e7964961c1ecda4b6a1fdeec4435d01726663666484f",
134          "templateId": "170929b11d5f0ed1385f890f42887c31ff7e289c0f4bc482aff193a7173d576c:Utility.Registry.App.V0.Model.Transfer:TransferOffer",
135          "contractKey": null,
136          "createArgument": {
137            "operator": "operator::1220b39df5ed0e3c584cd97e86e779def933d545bf9a4fab3c0fd3e4ad3f7a36b8fe",
138            "provider": "provider::1220d301ababbed7bc8d6f6a80ce16f33933a7274a3013241b7fb373ca7e4f0d6567",
139            "transfer": {
140              "sender": "issuer::1220d301ababbed7bc8d6f6a80ce16f33933a7274a3013241b7fb373ca7e4f0d6567",
141              "receiver": "holder::1220d301ababbed7bc8d6f6a80ce16f33933a7274a3013241b7fb373ca7e4f0d6567",
142              "amount": "10.0000000000",
143              "instrumentId": {
144                "admin": "registrar::1220d301ababbed7bc8d6f6a80ce16f33933a7274a3013241b7fb373ca7e4f0d6567",
145                "id": "INST"
146              },
147              "requestedAt": "2025-10-10T10:31:54Z",
148              "executeBefore": "2025-10-10T11:31:54Z",
149              "inputHoldingCids": [
150                "0041f93610a76b343fe5e969b953805a23674304341ff36a8e61fa1df0be6fc7f3ca111220877889786a97380f80e2a00e0da81525833982d789c9d72dc43ddc24d215eecb"
151              ],
152              "meta": {
153                "values": {
154                  "splice.lfdecentralizedtrust.org/reason": ""
155                }
156              }
157            }
158          },
159          "createdEventBlob": "",
160          "interfaceViews": [],
161          "witnessParties": [
162            "issuer::1220d301ababbed7bc8d6f6a80ce16f33933a7274a3013241b7fb373ca7e4f0d6567"
163          ],
164          "signatories": [
165            "issuer::1220d301ababbed7bc8d6f6a80ce16f33933a7274a3013241b7fb373ca7e4f0d6567",
166            "provider::1220d301ababbed7bc8d6f6a80ce16f33933a7274a3013241b7fb373ca7e4f0d6567",
167            "registrar::1220d301ababbed7bc8d6f6a80ce16f33933a7274a3013241b7fb373ca7e4f0d6567"
168          ],
169          "observers": [
170            "holder::1220d301ababbed7bc8d6f6a80ce16f33933a7274a3013241b7fb373ca7e4f0d6567",
171            "operator::1220b39df5ed0e3c584cd97e86e779def933d545bf9a4fab3c0fd3e4ad3f7a36b8fe"
172          ],
173          "createdAt": "2025-10-10T10:31:55.117218Z",
174          "packageName": "utility-registry-app-v0"
175        }
176      }
177    ],
178    "offset": 4249,
179    "synchronizerId": "global-domain::1220f0c14212edfc6ca9b0dfc6f5943b51a80efe71de8abf5759c8f57b7510f633eb",
180    "traceContext": {
181      "traceparent": "00-4ddd5bfb8c08ed720dea79fb2e988cdb-6a13bc923bea9975-01",
182      "tracestate": null
183    },
184    "recordTime": "2025-10-10T10:31:55.154179Z"
185  }
186}
After the exercise command is executed, the amount is locked by the admin.

Positions after the sender has offered the transfer
Step 2: Receiver Accepts the Transfer Offer
Step 2a - Obtain the Ledger End Offset
To obtain the ledger end offset, run the following script:

 1#!/usr/bin/env bash
 2
 3## =================================================================================================
 4## Receiver accepts offer
 5## Step 2a: Obtains ledger end offset
 6## Authorized by: Receiver
 7## Script: step-2a-receiver-accepts.sh
 8## =================================================================================================
 9
10DATAFILE="source.sh"
11source "$DATAFILE"
12
13# obtain ledger end
14OFFSET=$(curl -s GET \
15    --url "${HTTP_JSON_API}/v2/state/ledger-end" \
16    --header "Accept: application/json" \
17    --header "Authorization: Bearer ${RECEIVER_TOKEN}")
18
19echo "$OFFSET" | jq
20
21OUTPUTFILE="response-step-2a.json"
22echo "$OFFSET" > "$OUTPUTFILE"
The result is the ledger end offset at this moment, stored in response-step-2a.json. For example:

1{
2  "offset": 4251
3}
Step 2b - Retrieve Transfer Offer
To retrieve the Transfer Offer created in Step 1d, run the following script:

 1#!/usr/bin/env bash
 2
 3## =================================================================================================
 4## Receiver accepts offer
 5## Step 2b: Retrieves the transfer offer to accept
 6## Authorized by: Receiver
 7## Script: step-2b-receiver-accepts.sh
 8## =================================================================================================
 9
10DATAFILE="source.sh"
11source "$DATAFILE"
12
13JSONCONTENT=$(cat "response-step-2a.json")
14OFFSET=$(echo "$JSONCONTENT" | jq -r ".offset")
15
16RESULT=$(
17    curl -s \
18    --url "${HTTP_JSON_API}/v2/state/active-contracts" \
19    --header "Authorization: Bearer ${RECEIVER_TOKEN}" \
20    --header "Content-Type: application/json" \
21    --request POST \
22    --data @- <<EOF
23{
24    "verbose": false,
25    "activeAtOffset": "${OFFSET}",
26    "filter": {
27        "filtersByParty": {
28            "${RECEIVER_PARTY_ID}": {
29                "cumulative": [{
30                    "identifierFilter": {
31                        "InterfaceFilter": {
32                            "value": {
33                                "interfaceId":"$TRANSFER_INSTRUCTION_INTERFACE",
34                                "includeInterfaceView": true,
35                                "includeCreatedEventBlob": false
36                            }
37                        }
38                    }
39                }]
40            }
41        }
42    }
43}
44EOF
45)
46
47echo "--- Transfer Offer for Sender ---"
48echo "$RESULT" | jq
49
50OUTPUTFILE="response-step-2b.json"
51echo "$RESULT" > "$OUTPUTFILE"
The result is the Transfer Offer, stored in response-step-2b.json. For example,

 1[
 2  {
 3    "workflowId": "",
 4    "contractEntry": {
 5      "JsActiveContract": {
 6        "createdEvent": {
 7          "offset": 4249,
 8          "nodeId": 9,
 9          "contractId": "00faddf948ee97e0d70be1baad6517e8af6a1bbd57e0646c300e2d23857bacb38fca11122059a0b3f54bafc2deab11e7964961c1ecda4b6a1fdeec4435d01726663666484f",
10          "templateId": "170929b11d5f0ed1385f890f42887c31ff7e289c0f4bc482aff193a7173d576c:Utility.Registry.App.V0.Model.Transfer:TransferOffer",
11          "contractKey": null,
12          "createArgument": null,
13          "createdEventBlob": "",
14          "interfaceViews": [
15            {
16              "interfaceId": "55ba4deb0ad4662c4168b39859738a0e91388d252286480c7331b3f71a517281:Splice.Api.Token.TransferInstructionV1:TransferInstruction",
17              "viewStatus": {
18                "code": 0,
19                "message": "",
20                "details": []
21              },
22              "viewValue": {
23                "originalInstructionCid": null,
24                "transfer": {
25                  "sender": "issuer::1220d301ababbed7bc8d6f6a80ce16f33933a7274a3013241b7fb373ca7e4f0d6567",
26                  "receiver": "holder::1220d301ababbed7bc8d6f6a80ce16f33933a7274a3013241b7fb373ca7e4f0d6567",
27                  "amount": "10.0000000000",
28                  "instrumentId": {
29                    "admin": "registrar::1220d301ababbed7bc8d6f6a80ce16f33933a7274a3013241b7fb373ca7e4f0d6567",
30                    "id": "INST"
31                  },
32                  "requestedAt": "2025-10-10T10:31:54Z",
33                  "executeBefore": "2025-10-10T11:31:54Z",
34                  "inputHoldingCids": [
35                    "0041f93610a76b343fe5e969b953805a23674304341ff36a8e61fa1df0be6fc7f3ca111220877889786a97380f80e2a00e0da81525833982d789c9d72dc43ddc24d215eecb"
36                  ],
37                  "meta": {
38                    "values": {
39                      "splice.lfdecentralizedtrust.org/reason": ""
40                    }
41                  }
42                },
43                "status": {
44                  "tag": "TransferPendingReceiverAcceptance",
45                  "value": {}
46                },
47                "meta": {
48                  "values": {}
49                }
50              }
51            }
52          ],
53          "witnessParties": [
54            "holder::1220d301ababbed7bc8d6f6a80ce16f33933a7274a3013241b7fb373ca7e4f0d6567"
55          ],
56          "signatories": [
57            "issuer::1220d301ababbed7bc8d6f6a80ce16f33933a7274a3013241b7fb373ca7e4f0d6567",
58            "provider::1220d301ababbed7bc8d6f6a80ce16f33933a7274a3013241b7fb373ca7e4f0d6567",
59            "registrar::1220d301ababbed7bc8d6f6a80ce16f33933a7274a3013241b7fb373ca7e4f0d6567"
60          ],
61          "observers": [
62            "holder::1220d301ababbed7bc8d6f6a80ce16f33933a7274a3013241b7fb373ca7e4f0d6567",
63            "operator::1220b39df5ed0e3c584cd97e86e779def933d545bf9a4fab3c0fd3e4ad3f7a36b8fe"
64          ],
65          "createdAt": "2025-10-10T10:31:55.117218Z",
66          "packageName": "utility-registry-app-v0"
67        },
68        "synchronizerId": "global-domain::1220f0c14212edfc6ca9b0dfc6f5943b51a80efe71de8abf5759c8f57b7510f633eb",
69        "reassignmentCounter": 0
70      }
71    }
72  }
73]
Step 2c - Access the Backend API
The request URL is ${BACKEND_API}/v0/registrars/${ADMIN_PARTY_ID}/registry/transfer-instruction/v1/${TRANSFEROFFER_CID}/choice-contexts/accept. To hit this endpoint, run the following script:

 1#!/usr/bin/env bash
 2
 3## =================================================================================================
 4## Receiver accepts offer
 5## Step 2c: Gets choice context and disclosure for the accept-transfer-offer command
 6## Authorized by: anyone
 7## Script: step-2c-receiver-accepts.sh
 8## =================================================================================================
 9
10DATAFILE="source.sh"
11source "$DATAFILE"
12
13DATE_FORMAT='+%Y-%m-%dT%H:%M:%SZ'
14NOW_ISO_TIMESTAMP=$(date -u "$DATE_FORMAT")
15ONEHOUR_ISO_TIMESTAMP=$(date -u -v +1H "$DATE_FORMAT")
16
17TRANSFEROFFER=$(cat "response-step-2b.json")
18TRANSFEROFFER_CID=$(echo $TRANSFEROFFER |jq '.[] | .contractEntry.JsActiveContract.createdEvent.contractId' | tr -d '"')
19
20RESULT=$(
21    curl -s \
22    --url "${BACKEND_API}/v0/registrars/${ADMIN_PARTY_ID}/registry/transfer-instruction/v1/${TRANSFEROFFER_CID}/choice-contexts/accept" \
23    --header "Content-Type: application/json" \
24    --request POST \
25    --data @- <<EOF
26{
27   "meta":{
28
29   },
30   "excludeDebugFields": true
31}
32EOF
33)
34
35echo "--- Endpoint response ---"
36echo $RESULT | jq
37
38OUTPUTFILE="response-step-2c.json"
39echo "$RESULT" > "$OUTPUTFILE"
The result contains the required choice context for executing the command, stored in response-step-2c.json. For example:

  1{
  2  "choiceContextData": {
  3    "values": {
  4      "app-reward-configuration": {
  5        "tag": "AV_ContractId",
  6        "value": "00525af6a6fd8c1580b6d80aad3dbcc298218ffcd501c9f30e126836a3bb9ada8bca111220c22ce1c7f07a549ad6c6739c7953dd8847f69773b5996169b7afd8c6d66438b9"
  7      },
  8      "utility.digitalasset.com/receiver-credentials": {
  9        "tag": "AV_List",
 10        "value": [
 11          {
 12            "tag": "AV_ContractId",
 13            "value": "0074aa76902b5f1641eff3bb2e86cccce989b35a6ecaddafe0d39989026b4a3d0aca111220a0d5a8472cea3189ce92e26398225b466edc904a2bf4e85f8636ca7e93bd1df8"
 14          }
 15        ]
 16      },
 17      "utility.digitalasset.com/app-reward-configuration": {
 18        "tag": "AV_ContractId",
 19        "value": "00525af6a6fd8c1580b6d80aad3dbcc298218ffcd501c9f30e126836a3bb9ada8bca111220c22ce1c7f07a549ad6c6739c7953dd8847f69773b5996169b7afd8c6d66438b9"
 20      },
 21      "receiver-credentials": {
 22        "tag": "AV_List",
 23        "value": [
 24          {
 25            "tag": "AV_ContractId",
 26            "value": "0074aa76902b5f1641eff3bb2e86cccce989b35a6ecaddafe0d39989026b4a3d0aca111220a0d5a8472cea3189ce92e26398225b466edc904a2bf4e85f8636ca7e93bd1df8"
 27          }
 28        ]
 29      },
 30      "instrument-configuration": {
 31        "tag": "AV_ContractId",
 32        "value": "00eca75bf1e14e192de69b58054cf62f2a60a9c0aae8f4d3491a4b2fad9f9731eaca111220b5fd51ccd498385b0ceaef63243fdfef6c2e62dd8d3a2f59fdb61a9099956481"
 33      },
 34      "sender-credentials": {
 35        "tag": "AV_List",
 36        "value": [
 37          {
 38            "tag": "AV_ContractId",
 39            "value": "00840216df4df7f46e853231f4cfcd23dfb98bc4a3d670b1e0ed3b9b9afa218aecca1112207057c74dc0da345b4ec3006eae3a55ac1cd7fc34aa23c13cf453f5b9a9884235"
 40          }
 41        ]
 42      },
 43      "utility.digitalasset.com/transfer-rule": {
 44        "tag": "AV_ContractId",
 45        "value": "0015765518fb417897baac4c0a1fa1eb05971900e98bd731ad46095b0685f101c0ca1112209c56cdafaf9bb1fad5e72d054af025c441a1d0185cd6a309c216a25b6b708dca"
 46      },
 47      "utility.digitalasset.com/sender-credentials": {
 48        "tag": "AV_List",
 49        "value": [
 50          {
 51            "tag": "AV_ContractId",
 52            "value": "00840216df4df7f46e853231f4cfcd23dfb98bc4a3d670b1e0ed3b9b9afa218aecca1112207057c74dc0da345b4ec3006eae3a55ac1cd7fc34aa23c13cf453f5b9a9884235"
 53          }
 54        ]
 55      },
 56      "utility.digitalasset.com/instrument-configuration": {
 57        "tag": "AV_ContractId",
 58        "value": "00eca75bf1e14e192de69b58054cf62f2a60a9c0aae8f4d3491a4b2fad9f9731eaca111220b5fd51ccd498385b0ceaef63243fdfef6c2e62dd8d3a2f59fdb61a9099956481"
 59      },
 60      "transfer-rule": {
 61        "tag": "AV_ContractId",
 62        "value": "0015765518fb417897baac4c0a1fa1eb05971900e98bd731ad46095b0685f101c0ca1112209c56cdafaf9bb1fad5e72d054af025c441a1d0185cd6a309c216a25b6b708dca"
 63      }
 64    }
 65  },
 66  "disclosedContracts": [
 67    {
 68      "templateId": "ed73d5b9ab717333f3dbd122de7be3156f8bf2614a67360c3dd61fc0135133fa:Utility.Registry.V0.Configuration.Instrument:InstrumentConfiguration",
 69      "contractId": "00eca75bf1e14e192de69b58054cf62f2a60a9c0aae8f4d3491a4b2fad9f9731eaca111220b5fd51ccd498385b0ceaef63243fdfef6c2e62dd8d3a2f59fdb61a9099956481",
 70      "createdEventBlob": "CgMyLjESpgkKRQDsp1vx4U4ZLeabWAVM9i8qYKnAquj000kaSy+tn5cx6soREiC1/VHM1Jg4Wwzq72MkP9/vbC5i3Y06L1n9thqQmZVkgRITdXRpbGl0eS1yZWdpc3RyeS12MBqNAQpAZWQ3M2Q1YjlhYjcxNzMzM2YzZGJkMTIyZGU3YmUzMTU2ZjhiZjI2MTRhNjczNjBjM2RkNjFmYzAxMzUxMzNmYRIHVXRpbGl0eRIIUmVnaXN0cnkSAlYwEg1Db25maWd1cmF0aW9uEgpJbnN0cnVtZW50GhdJbnN0cnVtZW50Q29uZmlndXJhdGlvbiKRBWqOBQpSClA6Tm9wZXJhdG9yOjoxMjIwYjM5ZGY1ZWQwZTNjNTg0Y2Q5N2U4NmU3NzlkZWY5MzNkNTQ1YmY5YTRmYWIzYzBmZDNlNGFkM2Y3YTM2YjhmZQpSClA6TnByb3ZpZGVyOjoxMjIwZDMwMWFiYWJiZWQ3YmM4ZDZmNmE4MGNlMTZmMzM5MzNhNzI3NGEzMDEzMjQxYjdmYjM3M2NhN2U0ZjBkNjU2NwpTClE6T3JlZ2lzdHJhcjo6MTIyMGQzMDFhYmFiYmVkN2JjOGQ2ZjZhODBjZTE2ZjMzOTMzYTcyNzRhMzAxMzI0MWI3ZmIzNzNjYTdlNGYwZDY1NjcKgAEKfmp8ClMKUTpPcmVnaXN0cmFyOjoxMjIwZDMwMWFiYWJiZWQ3YmM4ZDZmNmE4MGNlMTZmMzM5MzNhNzI3NGEzMDEzMjQxYjdmYjM3M2NhN2U0ZjBkNjU2NwoICgZCBElOU1QKGwoZQhdSZWdpc3RyYXJJbnRlcm5hbFNjaGVtZQoECgJaAAqBAQp/Wn0Ke2p5ClMKUTpPcmVnaXN0cmFyOjoxMjIwZDMwMWFiYWJiZWQ3YmM4ZDZmNmE4MGNlMTZmMzM5MzNhNzI3NGEzMDEzMjQxYjdmYjM3M2NhN2U0ZjBkNjU2NwoiCiBaHgocahoKDgoMQgppc0lzc3Vlck9mCggKBkIESU5TVAqBAQp/Wn0Ke2p5ClMKUTpPcmVnaXN0cmFyOjoxMjIwZDMwMWFiYWJiZWQ3YmM4ZDZmNmE4MGNlMTZmMzM5MzNhNzI3NGEzMDEzMjQxYjdmYjM3M2NhN2U0ZjBkNjU2NwoiCiBaHgocahoKDgoMQgppc0hvbGRlck9mCggKBkIESU5TVCpOcHJvdmlkZXI6OjEyMjBkMzAxYWJhYmJlZDdiYzhkNmY2YTgwY2UxNmYzMzkzM2E3Mjc0YTMwMTMyNDFiN2ZiMzczY2E3ZTRmMGQ2NTY3Kk9yZWdpc3RyYXI6OjEyMjBkMzAxYWJhYmJlZDdiYzhkNmY2YTgwY2UxNmYzMzkzM2E3Mjc0YTMwMTMyNDFiN2ZiMzczY2E3ZTRmMGQ2NTY3Mk5vcGVyYXRvcjo6MTIyMGIzOWRmNWVkMGUzYzU4NGNkOTdlODZlNzc5ZGVmOTMzZDU0NWJmOWE0ZmFiM2MwZmQzZTRhZDNmN2EzNmI4ZmU5rPtttqtABgBCKgomCiQIARIgQ1DsOZLYGVRiscestTBDQ3CqU27WvKQODudfxMesKCEQHg==",
 71      "synchronizerId": "",
 72      "debugPackageName": "utility-registry-v0",
 73      "debugPayload": {
 74        "operator": "operator::1220b39df5ed0e3c584cd97e86e779def933d545bf9a4fab3c0fd3e4ad3f7a36b8fe",
 75        "provider": "provider::1220d301ababbed7bc8d6f6a80ce16f33933a7274a3013241b7fb373ca7e4f0d6567",
 76        "registrar": "registrar::1220d301ababbed7bc8d6f6a80ce16f33933a7274a3013241b7fb373ca7e4f0d6567",
 77        "defaultIdentifier": {
 78          "source": "registrar::1220d301ababbed7bc8d6f6a80ce16f33933a7274a3013241b7fb373ca7e4f0d6567",
 79          "id": "INST",
 80          "scheme": "RegistrarInternalScheme"
 81        },
 82        "additionalIdentifiers": [],
 83        "issuerRequirements": [
 84          {
 85            "issuer": "registrar::1220d301ababbed7bc8d6f6a80ce16f33933a7274a3013241b7fb373ca7e4f0d6567",
 86            "requiredClaims": [
 87              {
 88                "_1": "isIssuerOf",
 89                "_2": "INST"
 90              }
 91            ]
 92          }
 93        ],
 94        "holderRequirements": [
 95          {
 96            "issuer": "registrar::1220d301ababbed7bc8d6f6a80ce16f33933a7274a3013241b7fb373ca7e4f0d6567",
 97            "requiredClaims": [
 98              {
 99                "_1": "isHolderOf",
100                "_2": "INST"
101              }
102            ]
103          }
104        ],
105        "providerAppRewardBeneficiaries": null
106      },
107      "debugCreatedAt": "2025-10-08T20:41:44.51Z"
108    },
109    {
110      "templateId": "ed73d5b9ab717333f3dbd122de7be3156f8bf2614a67360c3dd61fc0135133fa:Utility.Registry.V0.Rule.Transfer:TransferRule",
111      "contractId": "0015765518fb417897baac4c0a1fa1eb05971900e98bd731ad46095b0685f101c0ca1112209c56cdafaf9bb1fad5e72d054af025c441a1d0185cd6a309c216a25b6b708dca",
112      "createdEventBlob": "CgMyLjES/gUKRQAVdlUY+0F4l7qsTAofoesFlxkA6YvXMa1GCVsGhfEBwMoREiCcVs2vr5ux+tXnLQVK8CXEQaHQGFzWownCFqJba3CNyhITdXRpbGl0eS1yZWdpc3RyeS12MBp3CkBlZDczZDViOWFiNzE3MzMzZjNkYmQxMjJkZTdiZTMxNTZmOGJmMjYxNGE2NzM2MGMzZGQ2MWZjMDEzNTEzM2ZhEgdVdGlsaXR5EghSZWdpc3RyeRICVjASBFJ1bGUSCFRyYW5zZmVyGgxUcmFuc2ZlclJ1bGUigAJq/QEKUgpQOk5vcGVyYXRvcjo6MTIyMGIzOWRmNWVkMGUzYzU4NGNkOTdlODZlNzc5ZGVmOTMzZDU0NWJmOWE0ZmFiM2MwZmQzZTRhZDNmN2EzNmI4ZmUKUgpQOk5wcm92aWRlcjo6MTIyMGQzMDFhYmFiYmVkN2JjOGQ2ZjZhODBjZTE2ZjMzOTMzYTcyNzRhMzAxMzI0MWI3ZmIzNzNjYTdlNGYwZDY1NjcKUwpROk9yZWdpc3RyYXI6OjEyMjBkMzAxYWJhYmJlZDdiYzhkNmY2YTgwY2UxNmYzMzkzM2E3Mjc0YTMwMTMyNDFiN2ZiMzczY2E3ZTRmMGQ2NTY3Kk5wcm92aWRlcjo6MTIyMGQzMDFhYmFiYmVkN2JjOGQ2ZjZhODBjZTE2ZjMzOTMzYTcyNzRhMzAxMzI0MWI3ZmIzNzNjYTdlNGYwZDY1NjcqT3JlZ2lzdHJhcjo6MTIyMGQzMDFhYmFiYmVkN2JjOGQ2ZjZhODBjZTE2ZjMzOTMzYTcyNzRhMzAxMzI0MWI3ZmIzNzNjYTdlNGYwZDY1NjcyTm9wZXJhdG9yOjoxMjIwYjM5ZGY1ZWQwZTNjNTg0Y2Q5N2U4NmU3NzlkZWY5MzNkNTQ1YmY5YTRmYWIzYzBmZDNlNGFkM2Y3YTM2YjhmZTmkGJERtEAGAEIqCiYKJAgBEiAwHP4MvAbKwprrvngECIRBF9TJCxtOaWUOffwO0FoJxhAe",
113      "synchronizerId": "",
114      "debugPackageName": "utility-registry-v0",
115      "debugPayload": {
116        "operator": "operator::1220b39df5ed0e3c584cd97e86e779def933d545bf9a4fab3c0fd3e4ad3f7a36b8fe",
117        "provider": "provider::1220d301ababbed7bc8d6f6a80ce16f33933a7274a3013241b7fb373ca7e4f0d6567",
118        "registrar": "registrar::1220d301ababbed7bc8d6f6a80ce16f33933a7274a3013241b7fb373ca7e4f0d6567"
119      },
120      "debugCreatedAt": "2025-10-09T06:39:53.276Z"
121    },
122    {
123      "templateId": "dd3a9f2d51cc4c52d9ec2e1d7ff235298dcfb3afd1d50ab44328b1aaa9a18587:Utility.Registry.Holding.V0.Holding:Holding",
124      "contractId": "0041f93610a76b343fe5e969b953805a23674304341ff36a8e61fa1df0be6fc7f3ca111220877889786a97380f80e2a00e0da81525833982d789c9d72dc43ddc24d215eecb",
125      "createdEventBlob": "CgMyLjES7QoKRQBB+TYQp2s0P+XpablTgFojZ0MENB/zao5h+h3wvm/H88oREiCHeIl4apc4D4DioA4NqBUlgzmC14nJ1y3EPdwk0hXuyxIbdXRpbGl0eS1yZWdpc3RyeS1ob2xkaW5nLXYwGnQKQGRkM2E5ZjJkNTFjYzRjNTJkOWVjMmUxZDdmZjIzNTI5OGRjZmIzYWZkMWQ1MGFiNDQzMjhiMWFhYTlhMTg1ODcSB1V0aWxpdHkSCFJlZ2lzdHJ5EgdIb2xkaW5nEgJWMBIHSG9sZGluZxoHSG9sZGluZyLOBWrLBQpSClA6Tm9wZXJhdG9yOjoxMjIwYjM5ZGY1ZWQwZTNjNTg0Y2Q5N2U4NmU3NzlkZWY5MzNkNTQ1YmY5YTRmYWIzYzBmZDNlNGFkM2Y3YTM2YjhmZQpSClA6TnByb3ZpZGVyOjoxMjIwZDMwMWFiYWJiZWQ3YmM4ZDZmNmE4MGNlMTZmMzM5MzNhNzI3NGEzMDEzMjQxYjdmYjM3M2NhN2U0ZjBkNjU2NwpTClE6T3JlZ2lzdHJhcjo6MTIyMGQzMDFhYmFiYmVkN2JjOGQ2ZjZhODBjZTE2ZjMzOTMzYTcyNzRhMzAxMzI0MWI3ZmIzNzNjYTdlNGYwZDY1NjcKUApOOkxpc3N1ZXI6OjEyMjBkMzAxYWJhYmJlZDdiYzhkNmY2YTgwY2UxNmYzMzkzM2E3Mjc0YTMwMTMyNDFiN2ZiMzczY2E3ZTRmMGQ2NTY3CoABCn5qfApTClE6T3JlZ2lzdHJhcjo6MTIyMGQzMDFhYmFiYmVkN2JjOGQ2ZjZhODBjZTE2ZjMzOTMzYTcyNzRhMzAxMzI0MWI3ZmIzNzNjYTdlNGYwZDY1NjcKCAoGQgRJTlNUChsKGUIXUmVnaXN0cmFySW50ZXJuYWxTY2hlbWUKBAoCQgAKEQoPMg0xMC4wMDAwMDAwMDAwCt0BCtoBUtcBCtQBatEBCmMKYWpfCl0KW2JZClcKUTpPcmVnaXN0cmFyOjoxMjIwZDMwMWFiYWJiZWQ3YmM4ZDZmNmE4MGNlMTZmMzM5MzNhNzI3NGEzMDEzMjQxYjdmYjM3M2NhN2U0ZjBkNjU2NxICCgAKBAoCQgAKZApiUmAKXmpcCloKWGJWClQKTjpMaG9sZGVyOjoxMjIwZDMwMWFiYWJiZWQ3YmM4ZDZmNmE4MGNlMTZmMzM5MzNhNzI3NGEzMDEzMjQxYjdmYjM3M2NhN2U0ZjBkNjU2NxICCgAqTGlzc3Vlcjo6MTIyMGQzMDFhYmFiYmVkN2JjOGQ2ZjZhODBjZTE2ZjMzOTMzYTcyNzRhMzAxMzI0MWI3ZmIzNzNjYTdlNGYwZDY1NjcqT3JlZ2lzdHJhcjo6MTIyMGQzMDFhYmFiYmVkN2JjOGQ2ZjZhODBjZTE2ZjMzOTMzYTcyNzRhMzAxMzI0MWI3ZmIzNzNjYTdlNGYwZDY1NjcyTGhvbGRlcjo6MTIyMGQzMDFhYmFiYmVkN2JjOGQ2ZjZhODBjZTE2ZjMzOTMzYTcyNzRhMzAxMzI0MWI3ZmIzNzNjYTdlNGYwZDY1NjcyTm9wZXJhdG9yOjoxMjIwYjM5ZGY1ZWQwZTNjNTg0Y2Q5N2U4NmU3NzlkZWY5MzNkNTQ1YmY5YTRmYWIzYzBmZDNlNGFkM2Y3YTM2YjhmZTJOcHJvdmlkZXI6OjEyMjBkMzAxYWJhYmJlZDdiYzhkNmY2YTgwY2UxNmYzMzkzM2E3Mjc0YTMwMTMyNDFiN2ZiMzczY2E3ZTRmMGQ2NTY3OaLmNm3LQAYAQioKJgokCAESIKCtk3K2ucXddGo/5as+zuHiMCpqN8f/zBeUHYdkncTzEB4=",
126      "synchronizerId": "",
127      "debugPackageName": "utility-registry-holding-v0",
128      "debugPayload": {
129        "operator": "operator::1220b39df5ed0e3c584cd97e86e779def933d545bf9a4fab3c0fd3e4ad3f7a36b8fe",
130        "provider": "provider::1220d301ababbed7bc8d6f6a80ce16f33933a7274a3013241b7fb373ca7e4f0d6567",
131        "registrar": "registrar::1220d301ababbed7bc8d6f6a80ce16f33933a7274a3013241b7fb373ca7e4f0d6567",
132        "owner": "issuer::1220d301ababbed7bc8d6f6a80ce16f33933a7274a3013241b7fb373ca7e4f0d6567",
133        "instrument": {
134          "source": "registrar::1220d301ababbed7bc8d6f6a80ce16f33933a7274a3013241b7fb373ca7e4f0d6567",
135          "id": "INST",
136          "scheme": "RegistrarInternalScheme"
137        },
138        "label": "",
139        "amount": "10.0000000000",
140        "lock": {
141          "lockers": {
142            "map": [
143              [
144                "registrar::1220d301ababbed7bc8d6f6a80ce16f33933a7274a3013241b7fb373ca7e4f0d6567",
145                {}
146              ]
147            ]
148          },
149          "context": "",
150          "observers": {
151            "map": [
152              [
153                "holder::1220d301ababbed7bc8d6f6a80ce16f33933a7274a3013241b7fb373ca7e4f0d6567",
154                {}
155              ]
156            ]
157          }
158        }
159      },
160      "debugCreatedAt": "2025-10-10T10:31:55.117Z"
161    },
162    {
163      "templateId": "77df4e7b980c12de438d7b052141a762215fae790d81f71179c8fb534beb68f7:Utility.Credential.V0.Credential:Credential",
164      "contractId": "00840216df4df7f46e853231f4cfcd23dfb98bc4a3d670b1e0ed3b9b9afa218aecca1112207057c74dc0da345b4ec3006eae3a55ac1cd7fc34aa23c13cf453f5b9a9884235",
165      "createdEventBlob": "CgMyLjESrAcKRQCEAhbfTff0boUyMfTPzSPfuYvEo9ZwseDtO5ua+iGK7MoREiBwV8dNwNo0W07DAG6uOlWsHNf8NKojwTz0U/W5qYhCNRIVdXRpbGl0eS1jcmVkZW50aWFsLXYwGnMKQDc3ZGY0ZTdiOTgwYzEyZGU0MzhkN2IwNTIxNDFhNzYyMjE1ZmFlNzkwZDgxZjcxMTc5YzhmYjUzNGJlYjY4ZjcSB1V0aWxpdHkSCkNyZWRlbnRpYWwSAlYwEgpDcmVkZW50aWFsGgpDcmVkZW50aWFsIrIDaq8DClMKUTpPcmVnaXN0cmFyOjoxMjIwZDMwMWFiYWJiZWQ3YmM4ZDZmNmE4MGNlMTZmMzM5MzNhNzI3NGEzMDEzMjQxYjdmYjM3M2NhN2U0ZjBkNjU2NwpQCk46TGlzc3Vlcjo6MTIyMGQzMDFhYmFiYmVkN2JjOGQ2ZjZhODBjZTE2ZjMzOTMzYTcyNzRhMzAxMzI0MWI3ZmIzNzNjYTdlNGYwZDY1NjcKDwoNQgtJTlNUX0hvbGRlcgoPCg1CC0lOU1RfSG9sZGVyCgQKAlIACgQKAlIACnQKclpwCm5qbApQCk5CTGlzc3Vlcjo6MTIyMGQzMDFhYmFiYmVkN2JjOGQ2ZjZhODBjZTE2ZjMzOTMzYTcyNzRhMzAxMzI0MWI3ZmIzNzNjYTdlNGYwZDY1NjcKDgoMQgppc0hvbGRlck9mCggKBkIESU5TVApiCmBqXgpcClpiWApWClA6Tm9wZXJhdG9yOjoxMjIwYjM5ZGY1ZWQwZTNjNTg0Y2Q5N2U4NmU3NzlkZWY5MzNkNTQ1YmY5YTRmYWIzYzBmZDNlNGFkM2Y3YTM2YjhmZRICCgAqTGlzc3Vlcjo6MTIyMGQzMDFhYmFiYmVkN2JjOGQ2ZjZhODBjZTE2ZjMzOTMzYTcyNzRhMzAxMzI0MWI3ZmIzNzNjYTdlNGYwZDY1NjcqT3JlZ2lzdHJhcjo6MTIyMGQzMDFhYmFiYmVkN2JjOGQ2ZjZhODBjZTE2ZjMzOTMzYTcyNzRhMzAxMzI0MWI3ZmIzNzNjYTdlNGYwZDY1NjcyTm9wZXJhdG9yOjoxMjIwYjM5ZGY1ZWQwZTNjNTg0Y2Q5N2U4NmU3NzlkZWY5MzNkNTQ1YmY5YTRmYWIzYzBmZDNlNGFkM2Y3YTM2YjhmZTkcDve1q0AGAEIqCiYKJAgBEiAwqMkxtFdza9zEqr/gjGp0tLPnvuPsSDVBE/nBZoKEwBAe",
166      "synchronizerId": "",
167      "debugPackageName": "utility-credential-v0",
168      "debugPayload": {
169        "issuer": "registrar::1220d301ababbed7bc8d6f6a80ce16f33933a7274a3013241b7fb373ca7e4f0d6567",
170        "holder": "issuer::1220d301ababbed7bc8d6f6a80ce16f33933a7274a3013241b7fb373ca7e4f0d6567",
171        "id": "INST_Holder",
172        "description": "INST_Holder",
173        "validFrom": null,
174        "validUntil": null,
175        "claims": [
176          {
177            "subject": "issuer::1220d301ababbed7bc8d6f6a80ce16f33933a7274a3013241b7fb373ca7e4f0d6567",
178            "property": "isHolderOf",
179            "value": "INST"
180          }
181        ],
182        "observers": {
183          "map": [
184            [
185              "operator::1220b39df5ed0e3c584cd97e86e779def933d545bf9a4fab3c0fd3e4ad3f7a36b8fe",
186              {}
187            ]
188          ]
189        }
190      },
191      "debugCreatedAt": "2025-10-08T20:41:36.716Z"
192    },
193    {
194      "templateId": "ed73d5b9ab717333f3dbd122de7be3156f8bf2614a67360c3dd61fc0135133fa:Utility.Registry.V0.Configuration.AppReward:AppRewardConfiguration",
195      "contractId": "00525af6a6fd8c1580b6d80aad3dbcc298218ffcd501c9f30e126836a3bb9ada8bca111220c22ce1c7f07a549ad6c6739c7953dd8847f69773b5996169b7afd8c6d66438b9",
196      "createdEventBlob": "CgMyLjEStgYKRQBSWvam/YwVgLbYCq09vMKYIY/81QHJ8w4SaDaju5rai8oREiDCLOHH8HpUmtbGc5x5U92IR/aXc7WZYWm3r9jG1mQ4uRITdXRpbGl0eS1yZWdpc3RyeS12MBqLAQpAZWQ3M2Q1YjlhYjcxNzMzM2YzZGJkMTIyZGU3YmUzMTU2ZjhiZjI2MTRhNjczNjBjM2RkNjFmYzAxMzUxMzNmYRIHVXRpbGl0eRIIUmVnaXN0cnkSAlYwEg1Db25maWd1cmF0aW9uEglBcHBSZXdhcmQaFkFwcFJld2FyZENvbmZpZ3VyYXRpb24i9AJq8QIKUgpQOk5vcGVyYXRvcjo6MTIyMGIzOWRmNWVkMGUzYzU4NGNkOTdlODZlNzc5ZGVmOTMzZDU0NWJmOWE0ZmFiM2MwZmQzZTRhZDNmN2EzNmI4ZmUKUgpQOk5wcm92aWRlcjo6MTIyMGQzMDFhYmFiYmVkN2JjOGQ2ZjZhODBjZTE2ZjMzOTMzYTcyNzRhMzAxMzI0MWI3ZmIzNzNjYTdlNGYwZDY1NjcKxgEKwwFqwAEKTQpLOklEU086OjEyMjBmMGMxNDIxMmVkZmM2Y2E5YjBkZmM2ZjU5NDNiNTFhODBlZmU3MWRlOGFiZjU3NTljOGY1N2I3NTEwZjYzM2ViCm8KbWprClcKVTpTZmVlUmVjZWl2ZXJVczo6MTIyMGIzOWRmNWVkMGUzYzU4NGNkOTdlODZlNzc5ZGVmOTMzZDU0NWJmOWE0ZmFiM2MwZmQzZTRhZDNmN2EzNmI4ZmUKEAoOMgwwLjIwMDAwMDAwMDAqTm9wZXJhdG9yOjoxMjIwYjM5ZGY1ZWQwZTNjNTg0Y2Q5N2U4NmU3NzlkZWY5MzNkNTQ1YmY5YTRmYWIzYzBmZDNlNGFkM2Y3YTM2YjhmZTJOcHJvdmlkZXI6OjEyMjBkMzAxYWJhYmJlZDdiYzhkNmY2YTgwY2UxNmYzMzkzM2E3Mjc0YTMwMTMyNDFiN2ZiMzczY2E3ZTRmMGQ2NTY3ORA5UrarQAYAQioKJgokCAESIFdnuWlL+9/sSZnL9GgPVRMT0KYfFkQqkD1ffAXT9KgQEB4=",
197      "synchronizerId": "",
198      "debugPackageName": "utility-registry-v0",
199      "debugPayload": {
200        "operator": "operator::1220b39df5ed0e3c584cd97e86e779def933d545bf9a4fab3c0fd3e4ad3f7a36b8fe",
201        "provider": "provider::1220d301ababbed7bc8d6f6a80ce16f33933a7274a3013241b7fb373ca7e4f0d6567",
202        "details": {
203          "dso": "DSO::1220f0c14212edfc6ca9b0dfc6f5943b51a80efe71de8abf5759c8f57b7510f633eb",
204          "operatorAppRewardBeneficiary": {
205            "beneficiary": "feeReceiverUs::1220b39df5ed0e3c584cd97e86e779def933d545bf9a4fab3c0fd3e4ad3f7a36b8fe",
206            "weight": "0.2000000000"
207          }
208        }
209      },
210      "debugCreatedAt": "2025-10-08T20:41:42.691Z"
211    }
212  ]
213}
Step 2d - Accept the Transfer Offer
To finalize the transfer and move the asset from the sender to the receiver, execute the following script:

 1#!/usr/bin/env bash
 2
 3## =================================================================================================
 4## Receiver accepts offer
 5## Step 2d: Executes the accept transfer command
 6## Authorized by: Receiver
 7## Script: step-2d-receiver-accepts.sh
 8## =================================================================================================
 9
10DATAFILE="source.sh"
11source "$DATAFILE"
12
13INSTRUCTION=$(cat "response-step-2b.json")
14INSTRUCTION_TEMPLATE=$(echo $INSTRUCTION | jq '.[] | .contractEntry.JsActiveContract.createdEvent.interfaceViews[0].interfaceId' | tr -d '"')
15INSTRUCTION_CID=$(echo $INSTRUCTION | jq '.[] | .contractEntry.JsActiveContract.createdEvent.contractId')
16
17JSONCONTENT=$(cat "response-step-2c.json")
18CHOICECONTEXTDATA=$(echo $JSONCONTENT | jq .choiceContextData)
19DISCLOSEDCONTRACTS=$(echo $JSONCONTENT | jq .disclosedContracts)
20
21RESULT=$(
22    curl -s \
23    --url "${HTTP_JSON_API}/v2/commands/submit-and-wait-for-transaction" \
24    --header "Authorization: Bearer ${RECEIVER_TOKEN}" \
25    --header "Content-Type: application/json" \
26    --request POST \
27    --data @- <<EOF
28{
29   "commands":{
30        "commands":[
31            {
32                "ExerciseCommand":{
33                    "templateId":"${INSTRUCTION_TEMPLATE}",
34                    "contractId":${INSTRUCTION_CID},
35                    "choice":"TransferInstruction_Accept",
36                    "choiceArgument":{
37                        "extraArgs": {
38                            "context": $CHOICECONTEXTDATA,
39                            "meta":{
40                                "values":{
41
42                                }
43                            }
44                        }
45                    }
46                }
47            }
48        ],
49        "workflowId":"",
50        "userId":"${RECEIVER_USER_ID}",
51        "commandId":"$(uuidgen | tr -d '\n')",
52        "deduplicationPeriod":{
53            "DeduplicationDuration":{
54                "value":{
55                    "seconds":30,
56                    "nanos":0
57                }
58            }
59        },
60        "actAs":[
61            "${RECEIVER_PARTY_ID}"
62        ],
63        "readAs":[
64
65        ],
66        "submissionId":"$(uuidgen | tr -d '\n')",
67        "disclosedContracts": ${DISCLOSEDCONTRACTS},
68        "domainId":"",
69        "packageIdSelectionPreference":[]
70    }
71}
72EOF
73)
74
75echo "--- Command response ---"
76echo $RESULT | jq
77
78OUTPUTFILE="response-step-2d.json"
79echo "$RESULT" > "$OUTPUTFILE"
For example, this is the response of this command:

  1{
  2  "transaction": {
  3    "updateId": "1220aa3f401f39f902aff4a092e4d310bbc4acc0f2de8ae641d7659ed6334a83d1b8",
  4    "commandId": "94058279-B1B1-4B2D-BF5D-EA0B33DDDAD8",
  5    "workflowId": "",
  6    "effectiveAt": "2025-10-10T10:33:03.967184Z",
  7    "events": [
  8      {
  9        "ArchivedEvent": {
 10          "offset": 4253,
 11          "nodeId": 0,
 12          "contractId": "00faddf948ee97e0d70be1baad6517e8af6a1bbd57e0646c300e2d23857bacb38fca11122059a0b3f54bafc2deab11e7964961c1ecda4b6a1fdeec4435d01726663666484f",
 13          "templateId": "170929b11d5f0ed1385f890f42887c31ff7e289c0f4bc482aff193a7173d576c:Utility.Registry.App.V0.Model.Transfer:TransferOffer",
 14          "witnessParties": [
 15            "holder::1220d301ababbed7bc8d6f6a80ce16f33933a7274a3013241b7fb373ca7e4f0d6567"
 16          ],
 17          "packageName": "utility-registry-app-v0",
 18          "implementedInterfaces": []
 19        }
 20      },
 21      {
 22        "ArchivedEvent": {
 23          "offset": 4253,
 24          "nodeId": 7,
 25          "contractId": "0041f93610a76b343fe5e969b953805a23674304341ff36a8e61fa1df0be6fc7f3ca111220877889786a97380f80e2a00e0da81525833982d789c9d72dc43ddc24d215eecb",
 26          "templateId": "dd3a9f2d51cc4c52d9ec2e1d7ff235298dcfb3afd1d50ab44328b1aaa9a18587:Utility.Registry.Holding.V0.Holding:Holding",
 27          "witnessParties": [
 28            "holder::1220d301ababbed7bc8d6f6a80ce16f33933a7274a3013241b7fb373ca7e4f0d6567"
 29          ],
 30          "packageName": "utility-registry-holding-v0",
 31          "implementedInterfaces": []
 32        }
 33      },
 34      {
 35        "CreatedEvent": {
 36          "offset": 4253,
 37          "nodeId": 8,
 38          "contractId": "0071cf43411dd636eb4d6b63716f7138df3e2d77c42225e2ad7383e2a49358d07bca111220536af478df272adf2cfc4e3488e6d709397cc368112ec82a518f416fb9b0dc00",
 39          "templateId": "dd3a9f2d51cc4c52d9ec2e1d7ff235298dcfb3afd1d50ab44328b1aaa9a18587:Utility.Registry.Holding.V0.Holding:Holding",
 40          "contractKey": null,
 41          "createArgument": {
 42            "operator": "operator::1220b39df5ed0e3c584cd97e86e779def933d545bf9a4fab3c0fd3e4ad3f7a36b8fe",
 43            "provider": "provider::1220d301ababbed7bc8d6f6a80ce16f33933a7274a3013241b7fb373ca7e4f0d6567",
 44            "registrar": "registrar::1220d301ababbed7bc8d6f6a80ce16f33933a7274a3013241b7fb373ca7e4f0d6567",
 45            "owner": "holder::1220d301ababbed7bc8d6f6a80ce16f33933a7274a3013241b7fb373ca7e4f0d6567",
 46            "instrument": {
 47              "source": "registrar::1220d301ababbed7bc8d6f6a80ce16f33933a7274a3013241b7fb373ca7e4f0d6567",
 48              "id": "INST",
 49              "scheme": "RegistrarInternalScheme"
 50            },
 51            "label": "",
 52            "amount": "10.0000000000",
 53            "lock": null
 54          },
 55          "createdEventBlob": "",
 56          "interfaceViews": [],
 57          "witnessParties": [
 58            "holder::1220d301ababbed7bc8d6f6a80ce16f33933a7274a3013241b7fb373ca7e4f0d6567"
 59          ],
 60          "signatories": [
 61            "holder::1220d301ababbed7bc8d6f6a80ce16f33933a7274a3013241b7fb373ca7e4f0d6567",
 62            "registrar::1220d301ababbed7bc8d6f6a80ce16f33933a7274a3013241b7fb373ca7e4f0d6567"
 63          ],
 64          "observers": [
 65            "operator::1220b39df5ed0e3c584cd97e86e779def933d545bf9a4fab3c0fd3e4ad3f7a36b8fe",
 66            "provider::1220d301ababbed7bc8d6f6a80ce16f33933a7274a3013241b7fb373ca7e4f0d6567"
 67          ],
 68          "createdAt": "2025-10-10T10:33:03.967184Z",
 69          "packageName": "utility-registry-holding-v0"
 70        }
 71      },
 72      {
 73        "CreatedEvent": {
 74          "offset": 4253,
 75          "nodeId": 9,
 76          "contractId": "00134a9fbf51efd74d80fdaedde5d4ceeae0d0ebfd54dc1e359044c5e251e313c5ca1112205a60f7549af5531c01d163e74c428f54ffa0698f90947ecb6f50e4e831e33f30",
 77          "templateId": "ed73d5b9ab717333f3dbd122de7be3156f8bf2614a67360c3dd61fc0135133fa:Utility.Registry.V0.Holding.Transfer:ExecutedTransfer",
 78          "contractKey": null,
 79          "createArgument": {
 80            "transfer": {
 81              "operator": "operator::1220b39df5ed0e3c584cd97e86e779def933d545bf9a4fab3c0fd3e4ad3f7a36b8fe",
 82              "provider": "provider::1220d301ababbed7bc8d6f6a80ce16f33933a7274a3013241b7fb373ca7e4f0d6567",
 83              "registrar": "registrar::1220d301ababbed7bc8d6f6a80ce16f33933a7274a3013241b7fb373ca7e4f0d6567",
 84              "sender": "issuer::1220d301ababbed7bc8d6f6a80ce16f33933a7274a3013241b7fb373ca7e4f0d6567",
 85              "receiver": "holder::1220d301ababbed7bc8d6f6a80ce16f33933a7274a3013241b7fb373ca7e4f0d6567",
 86              "instrumentIdentifier": {
 87                "source": "registrar::1220d301ababbed7bc8d6f6a80ce16f33933a7274a3013241b7fb373ca7e4f0d6567",
 88                "id": "INST",
 89                "scheme": "RegistrarInternalScheme"
 90              },
 91              "amount": "10.0000000000",
 92              "reference": "",
 93              "batch": {
 94                "id": "",
 95                "size": "1",
 96                "settlementFrom": null,
 97                "settlementUntil": null
 98              }
 99            },
100            "senderLabel": "",
101            "receiverLabel": "",
102            "observers": null
103          },
104          "createdEventBlob": "",
105          "interfaceViews": [],
106          "witnessParties": [
107            "holder::1220d301ababbed7bc8d6f6a80ce16f33933a7274a3013241b7fb373ca7e4f0d6567"
108          ],
109          "signatories": [
110            "registrar::1220d301ababbed7bc8d6f6a80ce16f33933a7274a3013241b7fb373ca7e4f0d6567"
111          ],
112          "observers": [
113            "holder::1220d301ababbed7bc8d6f6a80ce16f33933a7274a3013241b7fb373ca7e4f0d6567",
114            "issuer::1220d301ababbed7bc8d6f6a80ce16f33933a7274a3013241b7fb373ca7e4f0d6567",
115            "operator::1220b39df5ed0e3c584cd97e86e779def933d545bf9a4fab3c0fd3e4ad3f7a36b8fe",
116            "provider::1220d301ababbed7bc8d6f6a80ce16f33933a7274a3013241b7fb373ca7e4f0d6567"
117          ],
118          "createdAt": "2025-10-10T10:33:03.967184Z",
119          "packageName": "utility-registry-v0"
120        }
121      }
122    ],
123    "offset": 4253,
124    "synchronizerId": "global-domain::1220f0c14212edfc6ca9b0dfc6f5943b51a80efe71de8abf5759c8f57b7510f633eb",
125    "traceContext": {
126      "traceparent": "00-be96f03df4261d384f3cfba5c03bf78e-a2134d9051f3a399-01",
127      "tracestate": null
128    },
129    "recordTime": "2025-10-10T10:33:04.009428Z"
130  }



Registry Utility - Transfer Preapproval API Example
This example shows how to create a TransferPreapproval contract via the HTTP JSON API.

Preparation
Prerequisites:

Access to a running Canton HTTP JSON API.

Local tools: bash, curl, jq, and uuidgen.

Add all the required information to the source.sh file:

 1#!/usr/bin/env bash
 2
 3## =================================================================================================
 4## Purpose: Configurations for this example, amend variables as needed.
 5## Script: source.sh
 6## =================================================================================================
 7
 8# Receiver details
 9RECEIVER_TOKEN="<PASTE_JWT_TOKEN_HERE>"
10RECEIVER_PARTY_ID="holder::1220e71be62943820d0f7ecc365fc498adcd25e1b1fd165f0ae9b65c343230f93579"
11RECEIVER_USER_ID="holder"
12
13# Operator details
14OPERATOR_PARTY_ID="operator::1220ae8c93e1f1263d0366cbc4c2a2fe587b5227e929ddd76528380c59deb58ada8f"
15# You can retrieve the operator party ID from `http://<host>/api/utilities/v0/operator`, e.g.
16# - Local:  `curl http://localhost:8080/api/utilities/v0/operator`
17# - DevNet: `curl https://api.utilities.digitalasset-dev.com/api/utilities/v0/operator`
18
19# Instrument admin (or registrar) details whose instruments are being preapproved.
20INSTRUMENT_ADMIN_PARTY_ID="registrar::1220e71be62943820d0f7ecc365fc498adcd25e1b1fd165f0ae9b65c343230f93579"
21
22# Instrument ids to preapprove (an empty list means all instruments are preapproved)
23INSTRUMENT_IDS='[
24	"INST"
25]'
26
27# JSON API endpoint
28# Example (local): HTTP_JSON_API="http://localhost:8001/api/json-api"
29# Example (remote): HTTP_JSON_API="https://<your-host>/api/json-api"
30HTTP_JSON_API="http://localhost:8001/api/json-api"
31
32# Daml template IDs (package-name qualified)
33TRANSFER_PREAPPROVAL_TEMPLATE="#utility-registry-app-v0:Utility.Registry.App.V0.Model.TransferPreapproval:TransferPreapproval"
The required information is:

Details of

Description

Receiver (authorizing user)

RECEIVER_TOKEN, RECEIVER_USER_ID, RECEIVER_PARTY_ID

Operator

OPERATOR_PARTY_ID

Instrument admin

INSTRUMENT_ADMIN_PARTY_ID: party whose instruments are being preapproved

Instrument IDs

INSTRUMENT_IDS: JSON array of instrument IDs (strings). Use [] for a blanket preapproval.

JSON API base URL

HTTP_JSON_API: HTTP JSON API base URL


Note

You can retrieve the OPERATOR_PARTY_ID via http://<your-host>/api/utilities/v0/operator, e.g.

Local: http://localhost:8080/api/utilities/v0/operator

DevNet: https://api.utilities.digitalasset-dev.com/api/utilities/v0/operator

Create Transfer Preapproval
This step submits a single transaction containing a single CreateCommand.

Run the following script:

 1#!/usr/bin/env bash
 2
 3## =================================================================================================
 4## How-to Tutorial: Create transfer preapproval
 5## Authorized by: receiver
 6## Script: create-transfer-preapproval.sh
 7## =================================================================================================
 8
 9set -euo pipefail
10
11SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
12source "${SCRIPT_DIR}/source.sh"
13
14OUTPUT_DIR="${SCRIPT_DIR}/../response"
15mkdir -p "$OUTPUT_DIR"
16
17# Validate inputs
18if [[ -z "${HTTP_JSON_API:-}" ]]; then
19    echo "Error: HTTP_JSON_API is not set in source.sh"
20    exit 1
21fi
22if [[ -z "${TRANSFER_PREAPPROVAL_TEMPLATE:-}" ]]; then
23    echo "Error: TRANSFER_PREAPPROVAL_TEMPLATE is not set in source.sh"
24    exit 1
25fi
26if [[ -z "${OPERATOR_PARTY_ID:-}" ]]; then
27    echo "Error: OPERATOR_PARTY_ID is not set in source.sh"
28    exit 1
29fi
30if [[ -z "${INSTRUMENT_ADMIN_PARTY_ID:-}" ]]; then
31    echo "Error: INSTRUMENT_ADMIN_PARTY_ID is not set in source.sh"
32    exit 1
33fi
34if [[ -z "${RECEIVER_TOKEN:-}" || -z "${RECEIVER_USER_ID:-}" || -z "${RECEIVER_PARTY_ID:-}" ]]; then
35    echo "Error: RECEIVER_TOKEN/RECEIVER_USER_ID/RECEIVER_PARTY_ID must be set in source.sh"
36    exit 1
37fi
38if [[ -z "${INSTRUMENT_IDS:-}" ]]; then
39    echo "Error: INSTRUMENT_IDS is not set in source.sh"
40    exit 1
41fi
42echo "${INSTRUMENT_IDS}" | jq -e 'type == "array" and all(.[]; type == "string")' >/dev/null
43
44COMMANDS_JSON=$(jq -n \
45    --arg templateId "${TRANSFER_PREAPPROVAL_TEMPLATE}" \
46    --arg operator "${OPERATOR_PARTY_ID}" \
47    --arg receiver "${RECEIVER_PARTY_ID}" \
48    --arg instrumentAdmin "${INSTRUMENT_ADMIN_PARTY_ID}" \
49    --argjson instrumentIds "${INSTRUMENT_IDS}" \
50    '[
51        {
52            CreateCommand: {
53                templateId: $templateId,
54                createArguments: {
55                    operator: $operator,
56                    receiver: $receiver,
57                    instrumentAdmin: $instrumentAdmin,
58                    instrumentAllowances: ($instrumentIds | map({id: .}))
59                }
60            }
61        }
62    ]')
63
64RESULT=$(
65    curl -s \
66        --url "${HTTP_JSON_API}/v2/commands/submit-and-wait-for-transaction" \
67        --header "Authorization: Bearer ${RECEIVER_TOKEN}" \
68        --header "Content-Type: application/json" \
69        --request POST \
70        --data @- <<EOF
71{
72    "commands": {
73        "commands": ${COMMANDS_JSON},
74        "workflowId": "",
75        "userId": "${RECEIVER_USER_ID}",
76        "commandId": "$(uuidgen | tr -d '\n')",
77        "deduplicationPeriod": {
78            "DeduplicationDuration": {
79                "value": { "seconds": 30, "nanos": 0 }
80            }
81        },
82        "actAs": [
83            "${RECEIVER_PARTY_ID}"
84        ],
85        "readAs": [],
86        "submissionId": "$(uuidgen | tr -d '\n')",
87        "disclosedContracts": [],
88        "domainId": "",
89        "packageIdSelectionPreference": []
90    }
91}
92EOF
93)
94
95echo "--- Command response ---"
96echo "$RESULT" | jq
97
98OUTPUTFILE="response-step-1.json"
99echo "$RESULT" > "$OUTPUTFILE"
The result is the transaction response stored in response/response.json.

Example response:

 1{
 2    "transaction": {
 3        "updateId": "1220d28660de73bc898696c75955f9ad3cf99ca7d317634a29749779e2c960d81cdc",
 4        "commandId": "C07EC6B2-25E0-46E5-B0A2-1AB04BF0BD31",
 5        "workflowId": "",
 6        "effectiveAt": "2026-02-05T15:25:53.665284Z",
 7        "events": [
 8            {
 9                "CreatedEvent": {
10                    "offset": 339,
11                    "nodeId": 0,
12                    "contractId": "00c2307ab2eeb1d348197729fcae1dbfac52201392bf054fc955f278007a6d01b2ca1212201d0efef35a061299b59ab211bf9b3ed8cb05af08c808c4f26d2c9907a47089b7",
13                    "templateId": "f33ca939728c8401e67af3ab1dfc1ad7dc00fb35862bf5e964c5cdb3d5b6857c:Utility.Registry.App.V0.Model.TransferPreapproval:TransferPreapproval",
14                    "contractKey": null,
15                    "createArgument": {
16                        "operator": "operator::1220ae8c93e1f1263d0366cbc4c2a2fe587b5227e929ddd76528380c59deb58ada8f",
17                        "receiver": "holder::1220e71be62943820d0f7ecc365fc498adcd25e1b1fd165f0ae9b65c343230f93579",
18                        "instrumentAdmin": "registrar::1220e71be62943820d0f7ecc365fc498adcd25e1b1fd165f0ae9b65c343230f93579",
19                        "instrumentAllowances": [
20                            {
21                                "id": "INST"
22                            }
23                        ]
24                    },
25                    "createdEventBlob": "",
26                    "interfaceViews": [],
27                    "witnessParties": [
28                        "holder::1220e71be62943820d0f7ecc365fc498adcd25e1b1fd165f0ae9b65c343230f93579"
29                    ],
30                    "signatories": [
31                        "holder::1220e71be62943820d0f7ecc365fc498adcd25e1b1fd165f0ae9b65c343230f93579"
32                    ],
33                    "observers": [
34                        "operator::1220ae8c93e1f1263d0366cbc4c2a2fe587b5227e929ddd76528380c59deb58ada8f"
35                    ],
36                    "createdAt": "2026-02-05T15:25:53.665284Z",
37                    "packageName": "utility-registry-app-v0",
38                    "representativePackageId": "f33ca939728c8401e67af3ab1dfc1ad7dc00fb35862bf5e964c5cdb3d5b6857c",
39                    "acsDelta": true
40                }
41            }
42        ],
43        "offset": 339,
44        "synchronizerId": "global-domain::12208750245c5bca762b46827b41716c2d945838858b6ef97b35fb76817db0044d20",
45        "traceContext": {
46            "traceparent": "00-81a6821119081c80a3082310c434c8b9-ba14d7e97aa83062-01",
47            "tracestate": null
48        },
49        "recordTime": "2026-02-05T15:25:53.690588Z",
50        "externalTransactionHash": null
51    }
52}


