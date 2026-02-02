# Veracity IBKR Connector (Windows)

This folder contains the Windows tray app + connector executable for the IBKR integration. The installer **does not** bundle IBKR Client Portal Gateway binaries. Instead, the tray app downloads the official gateway zip from IBKR at install/run time.

## Projects

- **TrayApp** (`src/TrayApp`): WPF tray application (`Veracity IBKR Connector`).
- **Connector** (`src/Connector`): console connector that talks to the IBKR Client Portal Gateway and Veracity APIs.

## Key requirements

- IBKR gateway binaries are downloaded at runtime from the official URL configured in the tray app.
- Connector keys are stored using Windows DPAPI (never plaintext).
- Logs are written to `%APPDATA%\Veracity\logs\ibkr-connector.log`.

## Build the apps

```bash
cd installer/windows

dotnet restore

dotnet publish src/Connector/Connector.csproj -c Release -r win-x64 -p:PublishSingleFile=true -p:SelfContained=true

dotnet publish src/TrayApp/TrayApp.csproj -c Release -r win-x64 -p:PublishSingleFile=true -p:SelfContained=true
```

Output executables can be found under each project’s `bin/Release/net8.0-windows/win-x64/publish` directory.

## Create a single-file installer

We recommend [Velopack](https://velopack.io/) for a single-file Windows installer.

```bash
# Example (run in PowerShell)
# Install Velopack CLI once
# dotnet tool install -g vpk

# Package the Tray app + Connector exe
vpk pack \
  --packId VeracityIbkrConnector \
  --packVersion 1.0.0 \
  --packDir src/TrayApp/bin/Release/net8.0-windows/win-x64/publish \
  --mainExe VeracityIbkrConnector.TrayApp.exe \
  --outputDir dist
```

This produces a single installer executable under `dist/`.

## Configuration constants

Update these defaults in `src/TrayApp/AppConfig.cs`:

- `ServerUrl` (default `https://veracitysuite.com`)
- `GatewayUrl` (default `https://localhost:5000`)
- `GatewayZipUrl` (official IBKR download URL)

## Connector CLI usage

```bash
VeracityIbkrConnector.Connector.exe \
  --server https://veracitysuite.com \
  --gateway https://localhost:5000 \
  --pollSeconds 15 \
  --token <one-time-token>
```

Exit codes:
- `32`: connector key invalid (prompt user to paste a new token).

## Maintainer notes

- The installer must include:
  - Tray app executable
  - Connector executable
  - `conf.yaml` template
- The installer must **not** include IBKR gateway binaries. The tray app downloads them on demand.
