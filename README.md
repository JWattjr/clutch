# Clutch

**Turn a challenge into a quest.** Clutch is a chess-quest board where sponsors describe a one-game Lichess challenge, inspect a canonical checklist, and reserve non-monetary DEMO units. After a player links one Lichess account to one wallet and enrolls, GenLayer validators independently retrieve the game record; deterministic contract code checks the frozen conditions and records the result.

The supplied artboard is the approved visual reference. The browser experience includes the quest map and list, preview-only example quests, sponsor desk, wallet-backed account linking and enrollment, game submission, public receipts, and a separate historical replay sandbox. The sandbox never calls the contract or awards a reward.

## Current status

Clutch 0.1.1 is deployed to Studionet at `0x4FbfC02007698A4e5322c34A544934EbF8b73552` on chain `61999`. Live validator consensus passed for a test-only public Lichess game/profile probe and for supported and unsupported quest compilation. One 25-DEMO quest is active with a future time window. The production frontend build is READY at [clutch-genlayer.vercel.app](https://clutch-genlayer.vercel.app), but Vercel SSO currently blocks public access. Local checks passed, including 43 direct VM cases, strict TypeScript, ESLint, production build, browser smoke, and responsive checks. No user-controlled Lichess account is linked and no fresh game claim has been submitted. No Portal entry has been submitted. See [the feasibility record](docs/FEASIBILITY.md) and [review handoff](docs/REVIEW_HANDOFF.md) for transaction receipts and remaining steps.

## Stack

- Next.js 16 App Router, React 19, strict TypeScript, and `genlayer-js` 1.1.8.
- Python 3.12 or 3.13, with pinned GenLayer contract, linter, and test dependencies.
- Stable GenLayer Studionet, chain `61999`, and runner `py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6`.
- Lichess public game export and profile endpoints. The contract sends no Lichess token.
- Integer DEMO accounting only. No token transfers or cash value.

## Run the preview

Use Node.js `>=22.13.0` and Python `3.12` or `3.13`.

```powershell
npm ci
Copy-Item .env.example .env
npm run setup:python
npm run dev
```

Without `NEXT_PUBLIC_CONTRACT_ADDRESS`, Clutch opens in preview mode. Example quests are visibly marked as samples and have no live reward. To connect a deployed board, set `NEXT_PUBLIC_CONTRACT_ADDRESS` and `NEXT_PUBLIC_RPC_URL` in `.env`, then restart the dev server.

`npm run setup:python` creates a project-local `.venv` and installs the exact pins from `requirements.txt`. A first direct VM run also fetches the pinned GenVM runner into the ignored `.genvm-cache/` directory. Both downloads require package and release network access.

## Checks

```powershell
npm run lint
npm run typecheck
npm run build
npm run contract:lint
npm run contract:schema
npm run test:rules
npm run test:ui
npm run test:responsive
npm run offline:check
npm run test:direct
npm run check
```

`npm run offline:check` runs the local linter, ABI generation, source rule tests, lint, typecheck, production build, browser smoke check, and 390/768/1280/1440 responsive checks. It uses local Chrome or Edge; set `CLUTCH_BROWSER_EXECUTABLE` if the browser is not at a standard install path. Test screenshots go to ignored `test-artifacts/screenshots/`; Impeccable review captures go to `.impeccable/review/`.

`npm run test:direct` runs the GenLayer direct VM lifecycle tests using the contract's pinned runner. A fresh direct runner cache needs outbound access to the exact GenVM release. `npm run check` runs both the offline suite and direct VM tests. None of these commands submits a Portal entry.

`npm run probe:live` is a read-only host preflight. It checks Studionet chain/schema access and, when public IDs are set, anonymous Lichess game/profile responses. A host-side HTTP response is not evidence of validator agreement; the `test:integration` phases below are the on-chain checks.

`npm run probe:validators -- preflight` checks the separate four-method Lichess validator probe contract against the live Studionet schema without a key or write. After authorizing public test transactions, use a dedicated throwaway key in gitignored `.env` as `CLUTCH_DEPLOYER_PRIVATE_KEY`, set `CLUTCH_ALLOW_VALIDATOR_PROBE_WRITES=I_APPROVE_STUDIONET_VALIDATOR_PROBE`, then run `npm run probe:validators -- run`. That test-only contract makes validators independently fetch Lichess's published completed game and a public profile. The script checks finalized execution and majority agreement, saves transaction hashes and public normalized fields under ignored `deployments/validator-probe-studionet.json`, and resumes recorded transactions instead of blindly submitting duplicates. `npm run probe:validators -- status` reads the local evidence record. It never creates a quest or credits DEMO units.

## Deploy to Studionet

Use a dedicated throwaway Studionet wallet. Put its private key only in gitignored `.env` as `CLUTCH_DEPLOYER_PRIVATE_KEY`. The deploy command checks chain `61999`, asks Studio to compile the source pinned to the exact runner, deploys it, checks finalized execution and majority consensus, reads back `get_contract_info`, and records sanitized deployment evidence under `deployments/studionet.json`.

```powershell
npm run probe:live
npm run deploy
```

The deployed Clutch 0.1.1 address is `0x4FbfC02007698A4e5322c34A544934EbF8b73552`; the deployment receipt and source hash are recorded in `deployments/studionet.json` (ignored locally). The deployer must already have enough Studionet balance for another deployment. The script does not print, save, or fund a key. Keep `.env` private and never reuse a key from a sibling app.

## Prepare a demo draft

`seed:demo` uses `CLUTCH_DEMO_PRIVATE_KEY`, claims that wallet’s one-time starter DEMO allocation when needed, and creates one future-window draft. It does not compile, activate, fabricate a game, or create a proof. Because these are public Studionet writes, set this exact acknowledgement only when you intend to submit them:

```text
CLUTCH_ALLOW_STUDIONET_WRITES=I_APPROVE_STUDIONET_DEMO_STATE_CHANGES
```

Then run:

```powershell
npm run seed:demo
```

## Full live integration flow

The integration script never deploys, changes a Lichess profile, or invents a game. Use two separate throwaway wallets and set their private keys in `.env` as `CLUTCH_PROBE_SPONSOR_PRIVATE_KEY` and `CLUTCH_PROBE_PLAYER_PRIVATE_KEY`. Set `CLUTCH_CONTRACT_ADDRESS` and a stable `CLUTCH_INTEGRATION_RUN_ID` such as `local-trial`. The `prepare` phase checks live consensus for one supported description and one unsupported multi-game description. You may leave `CLUTCH_PROBE_LICHESS_ID` empty until requesting the profile challenge; then set it to an account you control. Keep the explicit write acknowledgement above set only during the intended trial.

Run phases in order:

```powershell
npm run test:integration -- prepare
npm run test:integration -- activate
npm run test:integration -- link-challenge
```

Copy the exact emitted challenge into the chosen Lichess account’s public profile bio yourself. Continue after the profile shows the text:

```powershell
npm run test:integration -- verify-link
npm run test:integration -- join
```

Play a new, qualifying game after activation and enrollment. Set `CLUTCH_PROBE_GAME_ID` to that game’s eight-character Lichess ID, then run:

```powershell
npm run test:integration -- claim
npm run verify:proof
```

Each phase waits for a finalized transaction with successful execution and majority agreement, then saves non-secret progress under `deployments/integration-<run-id>.json`. A non-qualifying or unavailable game remains an actual failed/insufficient receipt; it is not reported as a pass. `npm run test:integration -- status` prints the saved progress for that run.

## Project notes

- [Design decisions](DESIGN.md)
- [Product contract](PRODUCT.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Rule schema](docs/RULE_SCHEMA.md)
- [Feasibility evidence and live blockers](docs/FEASIBILITY.md)
- [Threat model](docs/THREAT_MODEL.md)
- [Demo walkthrough](docs/DEMO_SCRIPT.md)
- [Integration handoff](docs/REVIEW_HANDOFF.md)
- [Portal submission draft](docs/PORTAL_SUBMISSION.md)
