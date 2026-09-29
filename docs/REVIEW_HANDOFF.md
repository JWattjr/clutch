# Codex review handoff

## Status

Clutch 0.1.1 is deployed to Studionet, its supported and unsupported compiler paths passed live consensus, and two sponsor-funded DEMO quests are active: a same-day 1-DEMO test slot and a 25-DEMO follow-up slot. The test-only Lichess probe passed live validator reads for a public game and public profile; the user-controlled `wattxbt` account was subsequently linked through a successful live transaction. The production frontend build is READY on Vercel, but Vercel SSO currently prevents public access. Enrollment awaits the same-day slot's start, no qualifying game has been claimed, and no Portal entry has been submitted.

## Required reviewer checks

1. Review the state machine, compiler schema checks, source normalization, and accounting invariants in `contracts/clutch.py`.
2. Confirm no source/API or model call writes state before consensus returns.
3. Confirm the user saw and confirmed the exact hash of the checklist and explicit reward/time window.
4. Confirm wallet linking is stable-ID based, challenge-bound, immutable, and non-stealable.
5. Confirm deployment chain/runner and every transaction lifecycle plus execution result.
6. Compare desktop/mobile captures to the supplied UI reference and inspect keyboard behavior.
7. Confirm all demo content is labelled, no historical game reaches live settlement, and no DEMO amount is described as cash.
8. Resolve public access to the Vercel deployment; see the explicit SSO blocker below.

## Runtime acceptance record

- Frontend: production build, strict TypeScript, and ESLint passed. Browser smoke covered map/list, preview detail, sponsor gate, and proof shelf. Responsive checks passed at 390, 768, 1280, and 1440px without horizontal overflow. Captures are under `.impeccable/review/`.
- Contract: GenVM linter passed 3 checks; local schema reports 23 methods (13 view, 10 write). The runner is pinned to `py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6`.
- Direct tests: 43 pass locally (38 source rule cases plus five deterministic VM lifecycle cases using mocked model/profile inputs and the pinned local runner).
- Network: Studionet chain ID is `61999`. Live contract deployment and integration transactions reached `FINALIZED`, had successful leader execution, and reported `MAJORITY_AGREE`.
- Test-only validator probe: contract `0xA077BbEE06D38514f5563460872908886ff103b3`. Validators independently fetched and agreed on normalized data for public game `q7ZvsdUF` and anonymous public profile `thibault`. This proves the tested public endpoint paths, not a user-controlled profile link or a qualifying claim. Receipts are linked in `docs/FEASIBILITY.md`.
- Clutch deployment: version `clutch/0.1.1`, address `0x4FbfC02007698A4e5322c34A544934EbF8b73552`, source SHA-256 `246d517789f5f906e496bd06ddc9d1c69e687a8ccc1c40290e7629ba6a81366d`. Deployment transaction: `0xa1eceb722572aa18b22de72f59dba26883b5a8075edfb50134359e3a988e41a3`.
- Live compiler: “Win a rated blitz game as White in no more than 40 full moves” compiled to `max_plies: 80`, with frozen hash `029b664ce68022226bf6fd74363a0ad3e879d1ad51f468846ea5a0e843a77af3`. “Win three games consecutively” was stored as `UNSUPPORTED` / `UNSUPPORTED_MULTIGAME` with null rules.
- Scheduled demo quest: `quest-1`, 25 DEMO reserved, start `2026-09-30T06:45:30.173Z`, end `2026-10-02T06:45:30.173Z`. Activation transaction is `0x13a938331ee03e8861c1303b2cfe356d751e2f4fbf6c8412cb5c86b670b44d37`.
- Same-day test slot: `quest-3`, 1 DEMO reserved, start `2026-09-29T16:49:32.643Z`, end `2026-09-29T17:49:32.643Z` (`17:49–18:49 WAT`). [Activation receipt](https://explorer-studio.genlayer.com/tx/0x9fb26ed7672e313dd94e9f1b7609ab9a604f34882ae98b4b3f7978a4121c37df). The contract has a one-hour minimum window; overlapping slot quests are blocked by the helper to prevent duplicate-game awards across quests.
- Frontend deployment: project `clutch-genlayer`, alias [https://clutch-genlayer.vercel.app](https://clutch-genlayer.vercel.app). Vercel reports READY and the production build passed. Default SSO protection blocks public visitors; there is no custom domain. Automatic approval review rejected disabling SSO because explicit approval for that security-setting change was not present. Do not try an alternate path around that review; ask for explicit user approval or use a custom domain.
- Wallet linking: the user placed the exact challenge in `wattxbt`'s public bio. The [link transaction](https://explorer-studio.genlayer.com/tx/0x4b302a22770eead8fadc538fbb3bb740e9c79958652f96660690972dd024ef2e) finalized with successful execution and majority agreement; the contract confirmed the binding to the throwaway player wallet. The temporary bio text can be removed.
- Enrollment: an attempt before the scheduled play window [finalized with an execution error](https://explorer-studio.genlayer.com/tx/0x7f6ed6c9b0e50903e875c0dd85bcd9cb746ffd7894ada7061a746500ec2f3b62). The contract requires joining after the window opens. The player is not enrolled yet.
- Claim: no newly played post-activation game has been submitted; no claim or settlement is represented as successful.
- Portal: no entry has been submitted.
- Sanitized live records are in ignored `deployments/studionet.json`, `deployments/validator-probe-studionet.json`, and `deployments/integration-clutch-live-20260929-v2.json`. Private keys and deployment credentials remain only in local ignored environment files.

## Remaining user actions

1. Choose whether to authorize disabling SSO for this Clutch Vercel project or provide a custom domain.
2. Remove the temporary Lichess bio challenge if desired; the account link is already verified.
3. For today's slot, enroll after `quest-3` opens at 17:49 WAT and before starting a qualifying game. The command uses `CLUTCH_INTEGRATION_RUN_ID=fast-slot-20260929`.
4. If today's slot is missed, enroll in `quest-1` after it opens September 30 at 07:45 WAT.
5. Play a qualifying game after enrollment, then provide its Lichess game ID for claim verification.

No Portal submission should be made until the public frontend and user-controlled account-to-claim flow are demonstrated. See `docs/FEASIBILITY.md` for transaction links and dependency evidence.
