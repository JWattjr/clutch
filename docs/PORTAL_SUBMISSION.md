# Portal submission draft

## Project

**Clutch — Turn a challenge into a quest.**

Clutch lets sponsors describe a standard chess challenge in ordinary language. GenLayer validators independently compile it to a bounded canonical checklist, then independently retrieve and normalize a completed Lichess game after play. Deterministic contract code checks the frozen rules and settles one non-monetary DEMO accounting reward.

**Core explanation:** Agree on the rules before the game. Verify the result afterward.

## Scope

Lichess, standard chess, one completed game per claim, one successful claim per quest, one stable account binding per wallet, sponsor-funded DEMO accounting, public wallet-free proof review, and wallet-backed state transitions.

## Evidence collected

- Frontend: [clutch-genlayer.vercel.app](https://clutch-genlayer.vercel.app). Cookie-free HTTP 200 observed on September 30.
- Studionet chain: `61999`.
- Clutch contract: `0x4FbfC02007698A4e5322c34A544934EbF8b73552`, version `clutch/0.1.1`, pinned runner `py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6`.
- Deployment: [finalized deployment transaction](https://explorer-studio.genlayer.com/tx/0xa1eceb722572aa18b22de72f59dba26883b5a8075edfb50134359e3a988e41a3).
- Independent validator probe: [public game read](https://explorer-studio.genlayer.com/tx/0x6b75c0fdf2b6eed0d16b7d5f48bfc110aaf76bad58f1a40949bb166dae726fe5) and [anonymous profile read](https://explorer-studio.genlayer.com/tx/0xf486093b8d58d20b8cf2e41dfb7ca0619456741be731966fc6124d0fc30cf713), both finalized with successful execution and majority agreement.
- Compiler: live supported and unsupported descriptions both settled with majority agreement. Receipts and canonical fields are in `docs/FEASIBILITY.md`.
- Quest: a supported 25-DEMO quest activated with a scheduled future window; [activation transaction](https://explorer-studio.genlayer.com/tx/0x13a938331ee03e8861c1303b2cfe356d751e2f4fbf6c8412cb5c86b670b44d37).
- Same-day test slot: a second quest with the same rules and a 1 DEMO reward opened at 17:49 WAT on September 29 for one hour; [activation transaction](https://explorer-studio.genlayer.com/tx/0x9fb26ed7672e313dd94e9f1b7609ab9a604f34882ae98b4b3f7978a4121c37df).
- Account ownership: the user placed the exact challenge in `wattxbt`'s public profile bio; the [link transaction](https://explorer-studio.genlayer.com/tx/0x4b302a22770eead8fadc538fbb3bb740e9c79958652f96660690972dd024ef2e) finalized with successful execution and majority agreement. The contract bound the stable Lichess ID to the throwaway player wallet.
- Enrollment: the linked player joined the same-day `quest-3` slot after it opened; [enrollment transaction](https://explorer-studio.genlayer.com/tx/0x48564c89c20aa65c53500d3376ba06de7c37b8aec78ea53a1af1ae59ae562b7e).
- Local engineering checks: GenVM lint, schema generation, 43 direct tests, TypeScript, ESLint, production build, browser smoke, and responsive checks passed.

- Rejected proof: Game yQjRuAAG was submitted for quest-3 and finalized as NOT_QUALIFIED: White lost on time, and completion was about 70 seconds after the play deadline. No reward was credited. [Claim receipt](https://explorer-studio.genlayer.com/tx/0xe52028156f01689e85b6bb08ee8c6e4f288d07c7882f70cd940d7f950c716201). A successful live award remains outstanding.

## Evidence still required

- Confirm the final production URL and record a short reviewer walkthrough.
- Complete a new qualifying game after enrollment in an open quest and attach the successful award receipt. The new casual-draw presets reduce demo difficulty.
- Exercise expiry/refund accounting if it is required for the reviewer checklist.

## Honest current status

The deployment, public-source validator reads, supported/unsupported compiler outcomes, quest activation, user-controlled account linking, and player enrollment have live evidence. Game yQjRuAAG was submitted for quest-3 and finalized as NOT_QUALIFIED: White lost on time, and completion was about 70 seconds after the play deadline. No reward was credited. [Claim receipt](https://explorer-studio.genlayer.com/tx/0xe52028156f01689e85b6bb08ee8c6e4f288d07c7882f70cd940d7f950c716201). A successful live award remains outstanding. A pre-window enrollment attempt finalized with an execution error; enrollment later succeeded after the slot opened. Do not submit this as an end-to-end verified demonstration or claim guaranteed Portal points until those gaps are closed. No Portal entry has been submitted.

## Automated demonstration disclosure

The separate Clutch 0.2.0 BOT demo is deployed at `0x87AfF4A93fc1e5481Da1414bBb5CA45209CC510B`. Its casual draw quest is compiled, with no live BOT game or award yet. Once completed, describe the game as a scripted casual BOT API run; do not count it as evidence of competitive play or a successful human claim. Link both contracts and the actual receipt. See [setup and status](AUTOMATED_DEMO.md).
