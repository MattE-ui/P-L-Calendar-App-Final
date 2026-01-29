# IBKR Local Connector

The IBKR Client Portal Gateway runs locally on your machine and cannot be reached from the hosted Veracity server. The local connector bridges that gap by polling your gateway and forwarding normalized snapshots to Veracity.

## Requirements
- IBKR Client Portal Gateway running locally (default `http://127.0.0.1:5000`).
- A connector token generated from your Veracity profile (used once to exchange for a connector key stored locally).

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

After the first run, the connector exchanges your token for a connector key and stores it locally. Subsequent runs can omit `--token`.

### CLI flags
- `--server`: Veracity server base URL.
- `--token`: One-time connector token from the profile page (used to exchange for a connector key).
- `--connector-key`: Optional connector key override if you prefer not to use the stored key file.
- `--key-file`: Optional path for storing the connector key (default: `~/.veracity/ibkr-connector.json`).
- `--gateway`: Local Client Portal Gateway base URL.
- `--poll`: Poll interval in seconds (default 15).
- `--account`: Optional IBKR account ID override if you have multiple accounts.

## Troubleshooting
- `IBKR Gateway not running at http://127.0.0.1:5000`: Start the Client Portal Gateway.
- `Not authenticated`: Open the gateway UI in your browser and complete IBKR login + 2FA.
- `No IBKR account found`: Make sure the gateway session is authenticated and returns accounts.
