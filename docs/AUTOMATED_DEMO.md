# Automated casual BOT demo

This path removes manual chess play from the operator's demo. It uses two controlled Lichess BOT accounts and the official Bot API to play eight legal knight moves, offer a draw, and accept it. The game is casual and explicitly scripted. GenLayer still independently retrieves the public game and checks its frozen rules, identity, enrollment, timing, source category, and move list before awarding 1 non-monetary DEMO unit.

## Live deployment and current status

- Human board: Clutch 0.1.1 at `0x4FbfC02007698A4e5322c34A544934EbF8b73552`.
- Separate BOT demo: Clutch 0.2.0 at `0x87AfF4A93fc1e5481Da1414bBb5CA45209CC510B`, Studionet chain `61999`.
- BOT deployment transaction: `0x20a56bd78429c578874b2cd277d279f53ebd77b1da3174e61df590ebfcc978f5`.
- `quest-1` is compiled: casual standard draw, either color, any time control, no move limit; reward 1 DEMO; one-hour window opening on activation.
- Compile transaction: `0xce1e59f91bc3f5d98e6269c229da50f135d42924a791265a7a27ac6c6bf34296`.
- Deployment and compilation finalized with successful execution and majority agreement. No BOT accounts, game, claim, or successful BOT award have been recorded yet.

The public **Bot demo** tab reads the separate contract without requiring a wallet. It displays real quest state and claim checks. Browser assets contain neither tokens nor private keys. No public HTTP route starts a game or submits transactions.

## One-time account setup

1. Register two dedicated accounts at [Lichess signup](https://lichess.org/signup), using email addresses you control. Complete email/device verification and the site's agreements yourself. Follow Lichess's account rules; do not create extra accounts to bypass a restriction. Do not play games on these accounts before upgrading them.
2. In each account, create a [personal API token with `bot:play`](https://lichess.org/account/oauth/token/create?scopes%5B%5D=bot%3Aplay). Save each token directly into the gitignored `.env.bot-demo` file. Never paste tokens into chat, commit them, or put them in Vercel's public variables.
3. Set the two exact public usernames in the same file, alongside their tokens:

```text
CLUTCH_BOT_WHITE_ID=your_first_demo_account
CLUTCH_BOT_BLACK_ID=your_second_demo_account
CLUTCH_BOT_WHITE_TOKEN=...
CLUTCH_BOT_BLACK_TOKEN=...
```

The supplied `upgrade` command checks both exact account IDs, distinct accounts, and zero played games before an irreversible BOT conversion. It excludes Wattxbt. Already upgraded BOT accounts are accepted without converting them again. This command requires the explicit flag below. [Official BOT upgrade specification](https://raw.githubusercontent.com/lichess-org/api/master/doc/specs/tags/bot/api-bot-account-upgrade.yaml).

```powershell
npm run demo:bot -- upgrade --confirm-irreversible-bot-upgrade
npm run demo:bot -- preflight
```

4. The first `run` requests a wallet ownership challenge. Put its exact public line in the **first BOT account's bio**, then rerun. The challenge expires after 30 minutes. This is the same public profile-control check as human quests; the script checks visibility before asking validators to verify it. No chess is needed.

The account holder must handle signup agreements and any CAPTCHA or verification code. Automation uses the Bot API for moves; it never plays through a regular account's browser. [Lichess Fair Play](https://lichess.org/page/fair-play), [Terms of Service](https://lichess.org/terms-of-service).

## Operator commands

From the repository root:

```powershell
# Creates two new dedicated throwaway wallet keys locally; does not print them.
npm run demo:bot -- init

# Deploy once; recorded deployment and pending transaction are resumed.
npm run deploy:bot

$env:CLUTCH_ALLOW_STUDIONET_WRITES='I_APPROVE_STUDIONET_DEMO_STATE_CHANGES'

# Claims starter DEMO, creates a BOT draft, compiles, and inspects exact rules.
# Tokens are not needed yet. The play window does not begin here.
npm run demo:bot -- prepare

# With BOT tokens and bio setup: verifies link, activates, enrolls, challenges,
# plays moves, agrees a draw, submits public game ID, and verifies award state.
npm run demo:bot -- run

# Read-only contract and local run status.
npm run demo:bot -- status
```

The runner uses only its two configured BOT accounts, a casual standard 5+3 challenge, and known legal moves. The second account accepts the first account's challenge. It refuses differing accounts, rated games, variants, unexpected moves, unexpected endings, or mismatched frozen conditions. There is no scheduled wait: the one-hour play window starts at activation and enrollment follows immediately.

Transactions are recorded before waiting for finalization. On rerun, pending transaction hashes are awaited, completed steps are read back, and the same game is resumed. Game claims are attempted at most once per invocation; insufficient evidence can be retried subject to the contract's two-minute cooldown. HTTP 429 stops the invocation with a wait instruction. The runner sends requests sequentially. An expired challenge or play window needs operator inspection; it does not silently create more quests or games. A leftover run lock after a crash must be removed only after checking the recorded transaction.

Local run records live under ignored `deployments/`. An actual verified award produces `public/bot-demo-proof.json` with public game, quest, claim and evidence identifiers; no proof is fabricated while setup is pending. Publish that file with the next frontend deployment after the successful run.

## Contract policy and limitations

Source policy `lichess-standard-live/2` freezes the participant mode in the quest hash. `HUMAN_ONLY` excludes recognized BOT accounts. `BOT_DEMO` requires both accounts to carry the BOT title in the exported game and requires casual play, in addition to all normal predicates. `create_bot_demo_draft` freezes an activation-relative duration; activation records start/end timestamps without changing the approved hash. BOT drafts cannot be edited with the scheduled human draft method.

Claim receipts include participant mode, source-policy version, and frozen rule hash. A scripted BOT receipt demonstrates compilation, external-source consensus, predicates and conserved accounting; it does not demonstrate competitive play, fair-play detection, or a successful human award. Lichess remains the source of truth. The local runner has not yet completed a live game because account credentials are not configured.

Set only `NEXT_PUBLIC_BOT_DEMO_CONTRACT_ADDRESS` to the public demo address on Vercel. Keep `NEXT_PUBLIC_CONTRACT_ADDRESS` pointing to the human board. New source is 0.2.0; historical human deployment and integration scripts retain their 0.1.1 deployment checks.
