#!/bin/bash
# Upload DAR to Canton participant via gRPC
set -e

DAR_FILE="${1:-/home/ubuntu/splice-node/rhein-contracts/.daml/dist/rhein-finance-0.1.0.dar}"
PARTICIPANT_IP=$(docker inspect splice-validator-participant-1 --format='{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}')
CANTON_ADMIN_PORT=5002
CANTON_ADMIN_URL="${PARTICIPANT_IP}:${CANTON_ADMIN_PORT}"
GRPC_PACKAGE_SERVICE="com.digitalasset.canton.admin.participant.v30.PackageService"

echo "Uploading DAR: ${DAR_FILE}"
echo "Target: ${CANTON_ADMIN_URL}"

# Create the JSON request file with base64-encoded DAR
python3 -c "
import base64, json
with open('${DAR_FILE}', 'rb') as f:
    dar_bytes = base64.b64encode(f.read()).decode()
req = {
    'dars': [{'bytes': dar_bytes, 'description': 'Rhein Finance lending contracts'}],
    'vet_all_packages': True,
    'synchronize_vetting': True
}
with open('/tmp/upload-dar-request.json', 'w') as f:
    json.dump(req, f)
print(f'DAR size: {len(dar_bytes)} bytes (base64)')
"

# Upload via grpcurl
RESULT=$(grpcurl \
  -plaintext \
  -d @ \
  ${CANTON_ADMIN_URL} \
  ${GRPC_PACKAGE_SERVICE}.UploadDar \
  < /tmp/upload-dar-request.json)

echo "Response: ${RESULT}"

# Verify
echo ""
echo "Verifying upload..."
grpcurl -plaintext ${CANTON_ADMIN_URL} ${GRPC_PACKAGE_SERVICE}.ListPackages | \
  python3 -c "
import json, sys
data = json.load(sys.stdin)
total = len(data.get('packageDescriptions', []))
print(f'Total packages on participant: {total}')
for p in data.get('packageDescriptions', []):
    if 'rhein' in p.get('name', '').lower() or 'loan' in p.get('name', '').lower() or 'holding' in p.get('name', '').lower():
        print(f'  Found: {p[\"name\"]} v{p[\"version\"]} (id: {p[\"packageId\"][:16]}...)')
"

# Cleanup
rm -f /tmp/upload-dar-request.json
