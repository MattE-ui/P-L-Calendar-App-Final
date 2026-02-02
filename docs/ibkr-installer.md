# Veracity IBKR Windows Installer

This document explains how to build the Windows installer for the Veracity IBKR Connector tray app. The installer includes only Veracity components (tray app + connector) and **does not** include the IBKR Client Portal Gateway.

## Build prerequisites

- Node.js 22
- npm
- Windows machine for producing the `.exe` installer
- Inno Setup (ISCC on PATH)

## Build steps

```bash
# From repo root
npm install
npm --prefix ibkr-connector install
npm --prefix tray-app install

# Build the tray app + connector + installer
npm run tray:build
npm run connector:package
npm run installer:build
```

Output:
- `installer/dist/VeracitySetup.exe` (Inno Setup installer)

## Publish release

1. Upload the installer to GitHub Releases.
2. Set `IBKR_INSTALLER_URL` in Render to the release asset URL.
3. Verify `/api/integrations/ibkr/installer/status` returns `installerUrlSet: true`.

> Note: Do not commit installer binaries to the repo. Upload the `.exe` to GitHub Releases manually and point `IBKR_INSTALLER_URL` at the asset.

## Notes

- The tray app requires the user to install IBKR Client Portal Gateway separately from IBKR.
- The installer bundles the Veracity connector built from `ibkr-connector/dist`.
