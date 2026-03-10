Prerequisites
Validator
Having a running and properly configured validator node is a pre-requisite for using the Utilities on the Network.

Follow the instructions provided by the Global Synchronizer Foundation DevNet | TestNet | MainNet to setup a Validator Node

Participant Configuration
# required for the Utilities frontend
jsonApiServerPathPrefix: /api/json-api

# optional -- minimizes the amount of archived data in your Validator Node
participantPruningSchedule:
  cron: 0 0 14 * * ?
  maxDuration: 1h
  retention: 30d
Utilities Auth Setup
Warning

The audience configured for your utilities app should match the audience you have configured for your validator.

Utilities User/Party
While the Utility could work with the Validator Operator party (created via Validator setup), we recommend creating a separate user/party for the Utility workflows because this user is also used to pay for traffic on behalf of all other parties hosted on the validator and receives liveliness rewards. Separating these concerns facilitates easier accounting and management.

Create a separate user for the Utilities in your IAM system

Log into the Wallet UI with this new user

Click Onboard yourself (this creates the party)

Create Client ID for Frontend and Auto-Topup
Follow the same steps for setting up an External OIDC Provider as you have done for your Validator.

Specifically, you need to create a new application similar to the Wallet/CNS named ‘Utility UI’.

Once this has been created, ensure you copy the Client ID and Client Secret as these will be needed later as you specify this configuration in your values.yaml (using a Helm chart for deployment to Kubernetes) or as environment variables (if you are deploying via Docker Compose).



----


Install (Docker Compose)
Note

Make sure to complete the Prerequisites before proceeding.

If you deploy your validator using Docker Compose, then you can use this guide to add the DA Utilities to your setup.

Prerequisite: Auth
You need to set up auth for the utilities to work.

Don’t forget to use the -a flag when starting your node:

./start.sh -s "<SPONSOR_SV_URL>" -o "<ONBOARDING_SECRET>" -p "<party_hint>" -m "<MIGRATION_ID>" -w -a
Additional Environment Variables for Utilities
Add the following to your splice-node/docker-compose/validator/.env:

# Utility
AUTH_AUTHORITY=${AUTH_URL}
OIDC_AUTHORITY_URL=${AUTH_URL}
AUTH_AUDIENCE=${LEDGER_API_AUTH_AUDIENCE}
OIDC_AUTHORITY_LEDGER_API_AUDIENCE=${LEDGER_API_AUTH_AUDIENCE}
VALIDATOR_CLIENT_SECRET=${VALIDATOR_AUTH_CLIENT_SECRET}
VALIDATOR_CLIENT_ID=${VALIDATOR_AUTH_CLIENT_ID}
CNS_UI_CLIENT_ID=${ANS_UI_CLIENT_ID}
UTILITIES_IMAGE_REPO="europe-docker.pkg.dev/da-images/public/docker"
UTILITIES_IMAGE_VERSION="0.11.5"
AUTH_CLIENT_ID="<see below>"
UTILITY_APP_UTILITY_BACKEND_URL="<see below>"
AUTH_CLIENT_ID: the one you created for the Utility UI

UTILITY_APP_UTILITY_BACKEND_URL: depends on which network you’re connecting to

Update compose.yaml
Edit your participant deployment
participant:
  image: "${IMAGE_REPO}canton-participant:${IMAGE_TAG}"
  environment:
 - CANTON_PARTICIPANT_JSON_API_SERVER_PATH_PREFIX=/api/json-api
 - AUTH_JWKS_URL=${AUTH_JWKS_URL}
Add the Utilities
utility-ui:
  image: "${UTILITIES_IMAGE_REPO}/frontend:${UTILITIES_IMAGE_VERSION}"
  environment:
    - AUTH_AUTHORITY=${AUTH_AUTHORITY}
    - AUTH_CLIENT_ID=${AUTH_CLIENT_ID}
    - AUTH_AUDIENCE=${AUTH_AUDIENCE}
    - UTILITY_APP_UTILITY_BACKEND_URL=${UTILITY_APP_UTILITY_BACKEND_URL}
  depends_on:
    - participant
    - validator
  networks:
    - ${DOCKER_NETWORK:-splice_validator}

darsyncer:
  image: "${UTILITIES_IMAGE_REPO}/utilities-darsyncer-client:${UTILITIES_IMAGE_VERSION}"
  command:
    - --endpoint=participant:5002
  environment:
    - DARS=/dars
    - CLIENT_ID=${VALIDATOR_AUTH_CLIENT_ID}
    - CLIENT_SECRET=${VALIDATOR_AUTH_CLIENT_SECRET}
    - OAUTH_DOMAIN=${AUTH_AUTHORITY}
  depends_on:
    - participant
    - validator
  networks:
    - ${DOCKER_NETWORK:-splice_validator}
Make nginx depend on utility-ui
nginx:
  image: "nginx:${NGINX_VERSION}"
  depends_on:
    - ans-web-ui
    - wallet-web-ui
    - validator
 - utility-ui
Update nginx.conf
Add this to splice-node/docker-compose/validator/nginx.conf to access the Utility UI at http://utility.localhost:

http {
  ...
  server {
    listen 80;
    server_name utility.localhost;

    location /api/validator/ {
      rewrite ^\/(.*) /$1 break;
      proxy_pass http://validator:5003/api/validator;
    }

    location /api/json-api {
      rewrite ^\/(.*) /$1 break;
      proxy_pass http://participant:7575/;
    }

    location / {
      proxy_pass http://utility-ui:8080/;
    }
  }
}

--------

Ingress
Warning

Your ingress must be created in the same namespace where you have installed your validator, participant and utilities app.

All ingress traffic is routed through an included proxy listening on <chart-release-name>-ingress:80.

To setup ingress, two things are required:

Set the host in the values file:

# values.yaml
frontend:
  hostname: <hostname>
Configure your ingress provider to route traffic to the <chart-release-name>-ingress service on port 80 in the namespace you installed your validator, participant and utilities app.

Example
Using the Kubernetes default Ingress provider:

apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: utilities-ingress
  namespace: <chart-release-namespace>
spec:
  rules:
    - host: <hostname>
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: <chart-release-name>-ingress
                port:
                  number: 80
Using an Istio virtual service:

Note: This assumes that you are using the Istio setup which is provided in the official Splice docs here.

apiVersion: networking.istio.io/v1
kind: VirtualService
metadata:
  name: utilities-ingress
  namespace: <chart-release-namespace>
spec:
  gateways: cluster-ingress/cn-http-gateway
  hosts: <hostname>
  http:
  - match:
    - port: 443
      uri:
        prefix: /
    route:
    - destination:
        host: utilities-ingress.<chart-release-namespace>.svc.cluster.local
        port:
          number: 80


-------



Getting Started
Request a Credential Service
via the UI
Log in to the Utility UI https://<ingressHost.internal> with your user set up in Prerequisites

Select the “Credential” module

Press “REQUEST CREDENTIAL USER SERVICE”

Once these steps are complete, a request will appear in the corresponding DA Utility UI. To complete the onboarding, DA will have to approve the request.

via the API
If you did not deploy the UI, you can create a UserServiceRequest contract directly via the API, which is described in the Daml API Reference. It is important you set the Utility operator party correctly when creating the contract.

Guides and Examples
Utility Daml API Reference contains the API documentation for the credential models, credential app, registry models and the registry app, respectively.

Code examples using curl and TypeScript describe how to use the API in practice, containing examples both how to write (including explicit disclosure) and how to read.

Explore our tutorials to learn about different business flows and guided scenarios in the UI.

Additionally, read the user guides for the Credential Utility and Registry Utility to gain deeper insights into specific workflows and functionalities.



------------------

Auto TopUp Application
Perform automated topping up of either CredentialBilling or CommercialAgreement contracts when the locked deposits fall below a configurable threshold. If sufficient amulet is available, it is locked, and the respective contract has its deposit amount topped up to the configured balance using these newly locked amulets. The app tolerates transaction failure and backs off from retrying transactions. The total number of retries across a set of contracts is configurable via the MAX_RETRY_TOPUP_COUNT environment variable, defaulting to 8 retries. If the retry contract set is exhausted before the MAX_RETRY_TOPUP_COUNT is reached, the app is deemed to have run successfully.

Setup
You can configure the Auto TopUp image by setting environment variables in the container.

Deploy the application as either a native Kubernetes cronjob, where it runs as a script (APP_EXECUTION_MODE_SCRIPT=true), or as a regular long-running container (APP_EXECUTION_MODE_SCRIPT=false), where it is triggered based on a configured node cronjob. Configure appropriately to suit your case:

APP_EXECUTION_MODE_SCRIPT={true|false}
When configured as a long-running service ( APP_EXECUTION_MODE_SCRIPT=false), the application runs as a node cronjob on a schedule defined in the environment variable:

# This will run the job every day at midnight
AUTO_TOPUP_CRON_SCHEDULE="0 0 * * *"
Configure the deployments to target either CredentialBilling or CommercialAgreement contracts, or both:

ENABLE_CREDENTIAL_BILLING_TOPUP={true|false}
ENABLE_COMMERCIAL_AGREEMENT_TOPUP={true|false}
The app works by querying all live CredentialBilling or CommercialAgreement contracts and inspecting the respective locked amulet fields to compute the existing locked amulet amounts. It compares these amounts with the configurable top-up minimums, and if they fall below these values, it queries existing unlocked amulets in anticipation of performing the top-up to the configured maximum amounts. If sufficient amulet is available, the app locks the appropriate amount and updates the underlying contracts with the newly locked amounts. Configure the minimum threshold and the maximums in the environment file:

CREDENTIAL_BILLING_TOPUP_MIN_AMULET_BALANCE=1000
CREDENTIAL_BILLING_TOPUP_MAX_AMULET_BALANCE=10000

COMMERCIAL_AGREEMENT_TOPUP_MIN_AMULET_BALANCE=1000
COMMERCIAL_AGREEMENT_TOPUP_MAX_AMULET_BALANCE=10000
The app produces a detailed console log as it proceeds with the top-up. When the top-up fails to complete, the log provides the reason for the failure.

When topping up CommercialBilling contracts, the app interacts with the ledger as the issuer party and tops up the issuer’s deposit. In the case of CredentialBilling contracts, the app operates on behalf of the holder party and tops up the holder’s deposit. The issuer party is configured in the same environment file as the top-up minimums and maximums.

In the current configuration, the app calls an OpenID Connect (OIDC) provider to authenticate and obtain the token for the issuer.

When the app operates as a native cronjob (running as a node cronjob, as opposed to being in a Kubernetes cronjob container), the app caches the token to minimize the network overhead.

The following is a complete list of the environment variables. The values are solely for illustration. You must replace them with the actual values for your deployment:

APP_EXECUTION_MODE_SCRIPT=false

# This will run the job every day at midnight
AUTO_TOPUP_CRON_SCHEDULE="0 0 * * *"

ENABLE_CREDENTIAL_BILLING_TOPUP=true
ENABLE_COMMERCIAL_AGREEMENT_TOPUP=false

CREDENTIAL_BILLING_TOPUP_MIN_AMULET_BALANCE=1000
CREDENTIAL_BILLING_TOPUP_MAX_AMULET_BALANCE=10000
COMMERCIAL_AGREEMENT_TOPUP_MIN_AMULET_BALANCE=1000
COMMERCIAL_AGREEMENT_TOPUP_MAX_AMULET_BALANCE=10000

ISSUER=auth0_dgsd8h7yb6dcw1b3av7tvacf9l9k::j5sombp2tsu5foh04bnbdiu93llt0ujy1uhut88l03se8gg4cl2o042ro4lu7jog1234
OAUTH_CLIENT_ID=00000000000000000000000000000000
OAUTH_OIDC_CONF_URL=https://my-oidc-auth-provider.com/.well-known/openid-configuration
OAUTH_CLIENT_SECRET=XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
OAUTH_AUDIENCE=https://canton.registry.app

# Optional, defaults to 30 seconds
MINING_ROUND_OPEN_TIME_OFFSET_SECONDS=30

# Optional, defaults to 8 retries
MAX_RETRY_TOPUP_COUNT=8

# JSON API URL
JSON_API_URL=http://participant.validatornamespace.svc.cluster.local:7575/

# scan proxy API URL
SP_API_URL=http://validator-app.validatornamespace.svc.cluster.local:5003/api/validator



Active Contract State
UI Access
In the Utility UI, the entire state of active contracts is read only once for a given template or interface. By default, the initial query is made using WebSockets. The UI uses a regular HTTP call as a fallback if, for any reason, WebSockets fail to connect.

After the initial state is established, the Utility UI queries only for granular state updates and applies them on top of the initial state.

Both the initial state and all subsequent updates are stored in browser local storage.

This results in much faster response times when querying data from the UI, as well as a reduced network footprint.

Disabling WebSockets
By default, the initial state of active contracts is queried using WebSockets.

If, for any reason, you wish to disable this, follow the steps below.

Login to the Utility UI.

Enter user settings.

../_images/acs-disable-websockets-1.png
Toggle the “WebSockets” switch to disable it.

../_images/acs-disable-websockets-2.png
Now, all queries for active state contracts will be made via regular HTTP calls.

Troubleshooting
If you encounter any problems using the Utility UI with either displaying or querying for the data, try the solutions below.

Clearing Local Storage Cache
Clearing Local Storage cache may help when data is not rendering or not displaying properly. After doing this, the Utility UI will again query the server for the initial state of active contracts when entering affected views.

Login to the Utility UI.

Enter user settings.


All the data associated with the Utility UI in your browser local storage should now be removed.