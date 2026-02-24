# Obsidian + Emerald Theme

## Source of truth
Theme tokens are defined in `static/style.css` under `:root`.

## Usage rules
- Use semantic variables (`--surface-1`, `--text-muted`, `--accent`, `--danger`) instead of hard-coded colors.
- Profit/loss/neutral state classes are standardized via `window.ThemeUtils.applyPnlColorClass(el, value)` from `static/theme-utils.js`.
- Chart colors resolve from CSS tokens in `static/analytics.js` through `getThemeColor(...)`.

## Core tokens
- Base: `--bg`, `--surface-1`, `--surface-2`, `--surface-3`
- Text: `--text`, `--text-muted`, `--text-dim`
- Accent: `--accent`, `--accent-2`, `--accent-soft`, `--highlight`
- Status: `--success`, `--danger`, `--warning`, `--info`
- Effects: `--shadow`, `--shadow-soft`, `--glow-emerald`, `--glow-danger`
