# Veracity IBKR Tray App

This Electron tray app drives the local IBKR connector. It does **not** bundle IBKR Gateway.

## Development

```bash
npm --prefix tray-app install
npm run tray:dev
```

## Build (Windows)

```bash
npm run tray:build
```

The unpacked app will be available under `tray-app/dist/win-unpacked`.
