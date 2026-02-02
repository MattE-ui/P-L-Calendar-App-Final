# IBKR Connector (Windows)

The **Veracity IBKR Connector** runs locally on your Windows machine to sync IBKR portfolio value, open positions, and stop orders to Veracity. It connects to the official IBKR Client Portal Gateway running on your machine.

> **Important:** Veracity does **not** ship IBKR Gateway binaries. Download the Client Portal Gateway directly from IBKR.

## User setup guide

1. **Download and install** the **Veracity IBKR Connector (Windows)** from Profile → IBKR Integration.
2. **Install the IBKR Client Portal Gateway** directly from IBKR.
3. **Launch the tray app** (it appears in the system tray) and set the gateway folder path.
4. **Launch the Gateway** and complete IBKR login + 2FA in your browser (`https://localhost:5000`).
5. **Generate a one-time token** in Profile → IBKR Integration.
6. **Paste the token** into the tray app to start syncing.
7. **Keep the tray app running** to maintain portfolio sync.

### What the connector does

- Polls the Client Portal Gateway.
- Sends heartbeats and snapshots (portfolio value, positions, stop orders) to Veracity.
- Handles disconnects and prompts for a new token if the connector key is revoked.

### Security & privacy

- The one-time token is exchanged for a **connector key** stored locally on your machine.
- Veracity never stores IBKR credentials.
- Traffic is limited to your local gateway and Veracity endpoints.

## Troubleshooting

- **401 / Invalid key**: generate a new token in Profile → IBKR Integration and paste it into the tray app.
- **Gateway not authenticated**: open `https://localhost:5000` and complete IBKR login + 2FA.
- **Port 5000 in use**: update the gateway config + tray app settings to match a free port.
- **Firewall warnings**: allow local access to the gateway on `localhost`.

## Maintainer build instructions

See `installer/windows/README.md` for build steps and packaging.

### Publishing a new installer release

1. Build the tray app + connector exe.
2. Package a single installer using Velopack (or WiX/Squirrel).
3. Upload the installer to your releases bucket.
4. Update the metadata JSON or env vars used by the download endpoint:

```
IBKR_CONNECTOR_WINDOWS_URL=<signed URL>
IBKR_CONNECTOR_WINDOWS_VERSION=1.0.0
IBKR_CONNECTOR_WINDOWS_PUBLISHED_AT=2024-01-01T12:00:00Z
IBKR_CONNECTOR_WINDOWS_SHA256=<sha256>
IBKR_CONNECTOR_WINDOWS_NOTES=Initial release
IBKR_CONNECTOR_WINDOWS_RELEASE_NOTES_URL=https://veracitysuite.com/releases/ibkr-connector
```

### Environment variables

- `IBKR_CONNECTOR_WINDOWS_URL`: signed download URL (recommended)
- `IBKR_CONNECTOR_WINDOWS_FILE`: local file path for the installer (fallback)
- `IBKR_CONNECTOR_WINDOWS_META_PATH`: path to JSON meta file (optional)
- `IBKR_CONNECTOR_WINDOWS_VERSION`: current version (fallback)
- `IBKR_CONNECTOR_WINDOWS_PUBLISHED_AT`: ISO timestamp
- `IBKR_CONNECTOR_WINDOWS_SHA256`: installer hash
- `IBKR_CONNECTOR_WINDOWS_NOTES`: short notes
- `IBKR_CONNECTOR_WINDOWS_RELEASE_NOTES_URL`: release notes link
