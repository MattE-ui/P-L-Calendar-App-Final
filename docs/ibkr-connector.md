# IBKR Local Connector

The IBKR Client Portal Gateway runs locally on your machine and cannot be reached from the hosted Veracity server. The local connector bridges that gap by polling your gateway and forwarding normalized snapshots to Veracity.

## Requirements
- IBKR Client Portal Gateway running locally (default `http://127.0.0.1:5000`).
- A connector token generated from your Veracity profile.

## Install
```bash
cd ibkr-connector
npm install
npm run build
```

## Run
```bash
node dist/index.js \
  --server https://veracitysuite.com \
  --token <CONNECTOR_TOKEN> \
  --gateway http://127.0.0.1:5000 \
  --poll 15
```

### CLI flags
- `--server`: Veracity server base URL.
- `--token`: Connector token from the profile page.
- `--gateway`: Local Client Portal Gateway base URL.
- `--poll`: Poll interval in seconds (default 15).
- `--account`: Optional IBKR account ID override if you have multiple accounts.

## Troubleshooting
- `IBKR Gateway not running at http://127.0.0.1:5000`: Start the Client Portal Gateway.
- `Not authenticated`: Open the gateway UI in your browser and complete IBKR login + 2FA.
- `No IBKR account found`: Make sure the gateway session is authenticated and returns accounts.
