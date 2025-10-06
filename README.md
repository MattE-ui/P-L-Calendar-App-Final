# P&L Calendar App

This project provides a profit & loss tracking calendar with multi-scale views and built-in GBP/USD currency conversion.

## Features
- Secure sign-up/login with bcrypt-hashed passwords and HTTP-only cookies.
- Prompt new users to record their opening portfolio value and cumulative net deposits immediately after sign-in, and allow edits from the dashboard thereafter.
- Record daily portfolio values while separately tracking net deposits/withdrawals so both the evolving balance and cash-adjusted performance remain visible at a glance.
- Surface lifetime summary cards that highlight the current balance, cumulative net deposits, and performance excluding cash movements in both GBP and USD.
- Log same-day deposits or withdrawals alongside each portfolio value so cash movements adjust the balance without inflating profit/loss figures.
- Toggle between day, week, month, and year summaries.
- View data in GBP or USD using exchange rates fetched from the Open ER API and cached on the server.

## Getting Started
1. Install Node.js 22.
2. Install dependencies:
   ```bash
   npm install
   ```
3. Start the server:
   ```bash
   npm start
   ```
4. Visit [http://localhost:3000](http://localhost:3000) and use the **Sign Up** button to create an account, then log in with the same credentials.
5. After logging in for the first time, complete the profile setup form by entering your current portfolio value and lifetime net deposits (numeric values are required) so the calendar can separate performance from cash movements.

## Persisted Data
User accounts, sessions, and P&L entries are stored in `data.json`. Back up this file if you need to preserve your records across deployments.

## Deploying / Pushing to GitHub
All changes currently live on the local `work` branch. To publish them to your GitHub repository, push the branch from your machine or a Codespaces/CI session:

```bash
git push origin work
```

You can then merge the branch into your default branch on GitHub via pull request or fast-forward merge.

## Branches & Merging
The active development branch is `work`, which already contains the latest portfolio-value workflow. To merge it into your main branch locally:

```bash
git checkout work
git pull
git checkout main
git merge work
```

If Git reports conflicts, keep the versions that reference **recording daily portfolio values** (rather than entering raw profit/loss numbers) so the docs and UI stay aligned. Once everything looks correct, finish with:

```bash
git push origin main
```
