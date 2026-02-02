# Veracity IBKR Installer

This folder contains the Inno Setup script that packages the Windows installer (VeracitySetup.exe). It installs the tray app, connector executable, and optionally creates a Scheduled Task for auto-start at logon.

## Build prerequisites
- Windows machine
- Inno Setup (ISCC on PATH)
- Tray app built in `tray-app/dist/win-unpacked`
- Connector executable built at `connector/veracity-ibkr-connector.exe`

## Build

```bash
npm run tray:build
npm run connector:package
npm run installer:build
```

Output:
- `installer/dist/VeracitySetup.exe`

## Notes
- This installer does **not** include IBKR Client Portal Gateway.
- Users must download and install IBKR Gateway directly from IBKR.
