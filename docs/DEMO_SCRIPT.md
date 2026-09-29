# Demo script

## Wallet-free review

1. Open Clutch without connecting a wallet.
2. Browse the quest map or switch to the list view; filter by real Lichess speed and result.
3. Open a quest and inspect its natural-language challenge, canonical checklist, source policy, and evidence drawer.
4. Open Historical replay, enter a real completed Lichess game ID, and load its public evidence. The replay is labelled sandbox and cannot credit a live balance.

## Sponsor flow

1. Connect a wallet on Studionet (chain `61999`).
2. Request the one-time starter DEMO allocation if the wallet has not received it.
3. Enter a challenge, DEMO reward, scheduled play-window start, and expiry.
4. Compile the draft. Inspect the exact canonical checklist and any clarification/unsupported reason codes.
5. Confirm the checklist hash and activate in the second transaction. Wait for finality and verify execution succeeded.

## Player flow

1. Connect the wallet and request a profile-link challenge for a normalized Lichess user ID.
2. Copy the exact text into that account's profile bio.
3. Complete the link and wait for finalized execution. Remove the bio nonce afterward.
4. Join after the play window opens and before starting a game. Enrollment freezes wallet, stable account ID, and time.
5. Play one new qualifying standard game on Lichess and submit its eight-character game ID before the claim deadline.
6. Inspect each predicate, normalized source evidence, consensus transaction, and the public award receipt.

## Current workspace limitation

The app preview, sample quest details, sponsor view, and proof shelf are available without a deployment. For a real test run, use the staged commands in the README. They stop after issuing the exact profile challenge, which the player must place in their own Lichess bio. Use a newly played game after activation and enrollment for the live flow; historical replay never awards units.

The Clutch contract is deployed on Studionet. Live validator receipts exist for completed-game and public-profile reads, supported and unsupported rule compilation, quest activation, the user-controlled `wattxbt` account link, and enrollment. The player must now complete a new qualifying game within the selected quest window. See `FEASIBILITY.md` and `REVIEW_HANDOFF.md` for the current evidence and remaining steps.
