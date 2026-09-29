# Portal submission draft

## Project

**Clutch — Turn a challenge into a quest.**

Clutch lets sponsors describe a standard chess challenge in ordinary language. GenLayer validators independently compile it to a bounded canonical checklist, then independently retrieve and normalize a completed Lichess game after play. Deterministic contract code checks the frozen rules and settles one non-monetary DEMO accounting reward.

**Core explanation:** Agree on the rules before the game. Verify the result afterward.

## Scope

Lichess, standard chess, one completed game per claim, one successful claim per quest, one stable account binding per wallet, sponsor-funded DEMO accounting, public wallet-free proof review, and wallet-backed state transitions.

## Evidence collected

- Frontend: [https://clutch-genlayer.vercel.app](https://clutch-genlayer.vercel.app). Vercel reports the production deployment READY, but default SSO currently blocks public visitors. Resolve access before treating this as a public demo URL.
- Studionet chain: `61999`.
- Clutch contract: `0x4FbfC02007698A4e5322c34A544934EbF8b73552`, version `clutch/0.1.1`, pinned runner `py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6`.
- Deployment: [finalized deployment transaction](https://explorer-studio.genlayer.com/tx/0xa1eceb722572aa18b22de72f59dba26883b5a8075edfb50134359e3a988e41a3).
- Independent validator probe: [public game read](https://explorer-studio.genlayer.com/tx/0x6b75c0fdf2b6eed0d16b7d5f48bfc110aaf76bad58f1a40949bb166dae726fe5) and [anonymous profile read](https://explorer-studio.genlayer.com/tx/0xf486093b8d58d20b8cf2e41dfb7ca0619456741be731966fc6124d0fc30cf713), both finalized with successful execution and majority agreement.
- Compiler: live supported and unsupported descriptions both settled with majority agreement. Receipts and canonical fields are in `docs/FEASIBILITY.md`.
- Quest: a supported 25-DEMO quest activated with a scheduled future window; [activation transaction](https://explorer-studio.genlayer.com/tx/0x13a938331ee03e8861c1303b2cfe356d751e2f4fbf6c8412cb5c86b670b44d37).
- Account ownership: the user placed the exact challenge in `wattxbt`'s public profile bio; the [link transaction](https://explorer-studio.genlayer.com/tx/0x4b302a22770eead8fadc538fbb3bb740e9c79958652f96660690972dd024ef2e) finalized with successful execution and majority agreement. The contract bound the stable Lichess ID to the throwaway player wallet.
- Local engineering checks: GenVM lint, schema generation, 43 direct tests, TypeScript, ESLint, production build, browser smoke, and responsive checks passed.

## Evidence still required

- Make the production frontend publicly accessible. Vercel SSO disablement was rejected by automatic approval review pending explicit approval; a custom domain is another option.
- Enroll the linked player after the quest window opens on September 30 at 07:45 WAT and before playing, then submit a newly played qualifying game. Attach its normalized evidence and claim settlement receipts.
- Exercise expiry/refund accounting if it is required for the reviewer checklist.

## Honest current status

The deployment, public-source validator reads, supported/unsupported compiler outcomes, quest activation, and user-controlled account linking have live evidence. Enrollment and a live claim have not been demonstrated, and the Vercel URL remains SSO protected. A pre-window enrollment attempt correctly finalized with an execution error and did not enroll the player. Do not submit this as an end-to-end verified demonstration or claim guaranteed Portal points until those gaps are closed. No Portal entry has been submitted.
