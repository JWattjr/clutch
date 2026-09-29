# Dependency feasibility record

Checked 2026-09-28 and updated 2026-09-29 from the Clutch workspace. Read-only host checks and authorized Studionet transactions passed through the elevated network path. The ordinary workspace sandbox still blocks outbound sockets. The evidence below distinguishes host requests from validator consensus. The user-controlled account link succeeded; no enrollment or live claim is represented as successful.

## Probe results

| Requirement | Result | Evidence and remaining work |
|---|---|---|
| Read a completed Lichess game by ID from validators | **Passed** | The public example game `q7ZvsdUF` was independently fetched and agreed by validators in the isolated probe. Finalized receipt: [game consensus transaction](https://explorer-studio.genlayer.com/tx/0x6b75c0fdf2b6eed0d16b7d5f48bfc110aaf76bad58f1a40949bb166dae726fe5). The agreed normalized tuple included standard/rated/blitz/draw, both stable player IDs, source, timestamps, and 125 plies. |
| Read a profile bio without a secret credential | **Passed** | Anonymous `GET https://lichess.org/api/user/thibault?profile=true` returned a stable ID and bio field; validators independently agreed on those public fields in the isolated probe. Finalized receipt: [profile consensus transaction](https://explorer-studio.genlayer.com/tx/0xf486093b8d58d20b8cf2e41dfb7ca0619456741be731966fc6124d0fc30cf713). |
| Observe a user-entered nonce in that profile endpoint | **Pending user action** | The endpoint and validator read passed, but no Clutch link challenge has been issued and no user-controlled Lichess profile has been edited. Ask the user for the stable account ID, issue the exact deployment-bound challenge, then have them add it to their profile bio. |
| Independent validators agree on normalized game evidence | **Passed for the public example** | The isolated probe used `strict_eq` on normalized JSON and stored the agreed result after successful execution and majority agreement. This proves the tested endpoint path, not eligibility of a post-activation claim. |
| Independent validators agree on compiled quest rules | **Passed on Clutch 0.1.1** | Live supported and unsupported draft compilations finalized successfully. The supported result matched the frozen schema; “Win three games consecutively.” stored `UNSUPPORTED` with `UNSUPPORTED_MULTIGAME`. Receipts and exact results are below. |
| Deterministic expiry/deadline time | **Activation exercised; expiry boundary not tested live** | Clutch 0.1.1 accepted the scheduled window and activated `quest-1` with majority agreement. No expiry/refund boundary transaction has been run on Studionet. The GenLayer docs describe transaction timestamps as deterministic. |
| Selected network and pinned runner | **Passed and deployed** | RPC chain ID is `61999`. Studionet accepted and deployed Clutch 0.1.1 with 23 methods and runner `py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6`. Current source SHA-256: `246d517789f5f906e496bd06ddc9d1c69e687a8ccc1c40290e7629ba6a81366d`. Deployment address and receipt are below. |

## Requests and field mapping

### Completed game

- Endpoint: `GET https://lichess.org/game/export/{8-character-game-id}?moves=true&tags=true&clocks=false&evals=false&opening=false`.
- Headers: `Accept: application/json`, `User-Agent: Clutch/0.1`.
- Authentication: none. The Lichess OpenAPI schema marks this game export endpoint as public (`security: []`).
- Required fields: `id` → requested game identity; `rated` → rated condition; `variant` → standard chess; `speed` → bullet/blitz/rapid/classical; `createdAt` → game start in milliseconds; `lastMoveAt` → completion in milliseconds; `status` → finished outcome category; `players.white.user.id` and `players.black.user.id` → stable account IDs; `moves` → half-move count.
- Optional `winner` is required to establish a decisive win, except a documented draw status may have no winner. Missing essential fields produce insufficient evidence; they are never replaced with false or zero.
- `source` is also inspected to exclude imported, position-only, relay, and unknown categories. Recognized bot titles are excluded by the frozen source policy.

### Profile challenge

- Candidate endpoint: `GET https://lichess.org/api/user/{normalized-id}?profile=true`.
- Headers: `Accept: application/json`, `User-Agent: Clutch/0.1`; no secret authorization value is sent.
- Expected mapping: top-level `id` must equal the normalized stable Lichess ID; `profile.bio` must contain the exact current, unexpired challenge string.
- The OpenAPI schema's OAuth2 annotation is a specific unresolved dependency question. If anonymous profile retrieval is rejected, the account-link path remains unavailable under the product's no-secret rule; Clutch will surface the blocker rather than substitute frontend OAuth or a fixture.

## Environment evidence

The workspace's latest product config was checked in:

- `faultline/scripts/lib.ts` and `faultline/contracts/faultline.py`
- `ratchet/gltest.config.yaml`, `ratchet/contracts/ratchet.py`, and `ratchet/tests/integration/test_studio_next_proof.py`

The official GenLayer docs identify stable Studionet as chain `61999` and Studio-dev as chain `61997`. Ratchet's current deployment proof checks `61999`; Faultline's deploy script checks the RPC chain before deploying and pins the same runner.

An actual read-only JSON-RPC request was attempted from both PowerShell and the available Node runtime:

```text
POST https://studio.genlayer.com/api
{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}
```

Those initial PowerShell and Node requests were denied before reaching Studio or Lichess. The same denial recurred inside the ordinary workspace sandbox on 2026-09-29. A read-only retry with elevated network permission reached both services: Studio returned chain ID `0xf22f` and accepted the exact pinned Clutch schema; Lichess returned the public example game and the `thibault` profile bio. This resolves host reachability for that elevated path. It does not resolve validator reachability or demonstrate transaction execution and consensus.

## 2026-09-29 live read-only preflight

At 02:10 UTC, the earlier Clutch 0.1.0 source hashed to `7b7ebd3865927bce2d161590158dd52c86daebe100268bc9401c52b3c64bc502`. The following read-only command passed after the elevated network path was granted:

```powershell
$env:CLUTCH_PROBE_GAME_ID='q7ZvsdUF'
$env:CLUTCH_PROBE_LICHESS_ID='thibault'
npm run probe:live
```

The RPC reported stable Studionet chain `61999`; Studio accepted the pinned source and returned 23 contract methods. Lichess's published example game returned `id=q7ZvsdUF`, `rated=true`, `variant=standard`, `speed=blitz`, `status=draw`, `source=arena`, valid start/completion timestamps, both public player IDs, and 125 move tokens. The anonymous profile request returned HTTP 200 with stable ID `thibault` and a string bio. The probe prints field status only, not the bio contents. The completed-game shape check in `scripts/live-probe.ts` was tightened to validate every field needed for normalization. ESLint and strict TypeScript passed after that edit.

## 2026-09-29 validator and deployment results

Two throwaway Studionet wallets were generated for the sponsor/deployer and player. Their private keys are stored only in ignored local environment files. A separate test-only contract with no quests, balances, or rewards was deployed at `0xA077BbEE06D38514f5563460872908886ff103b3` (source SHA-256 `f5a791ab86bf20e77164059e8bbfc13ef2356d2fc381cea77bcf0ba530c478b1`). Deployment, public-game read, and anonymous-profile read each finalized with successful execution and `MAJORITY_AGREE`. The records are in ignored `deployments/validator-probe-studionet.json`.

- [Probe deployment](https://explorer-studio.genlayer.com/tx/0x5d8302d68356d49d3e5b634b5f12fa3a102347d9d897e55231b6e2ce532e6351)
- [Game consensus](https://explorer-studio.genlayer.com/tx/0x6b75c0fdf2b6eed0d16b7d5f48bfc110aaf76bad58f1a40949bb166dae726fe5)
- [Profile consensus](https://explorer-studio.genlayer.com/tx/0xf486093b8d58d20b8cf2e41dfb7ca0619456741be731966fc6124d0fc30cf713)

The first Clutch 0.1.0 deployment exposed an unsupported-response schema edge case: the model omitted `rules: null`, so the contract rejected an otherwise valid `UNSUPPORTED` result. Clutch 0.1.1 now fills only that omitted null field for noncompiled outcomes while retaining strict validation of all other keys and values. The earlier deployment is retained as historical evidence; the current application points to 0.1.1.

Clutch 0.1.1 source SHA-256 is `246d517789f5f906e496bd06ddc9d1c69e687a8ccc1c40290e7629ba6a81366d`; the deployed address is `0x4FbfC02007698A4e5322c34A544934EbF8b73552`, runner is `py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6`, and schema has 23 methods. [Deployment receipt](https://explorer-studio.genlayer.com/tx/0xa1eceb722572aa18b22de72f59dba26883b5a8075edfb50134359e3a988e41a3).

Live integration prepare compiled and stored both outcomes. The supported quest canonicalized to standard, rated, blitz, white win, at most 80 plies, with hash `029b664ce68022226bf6fd74363a0ad3e879d1ad51f468846ea5a0e843a77af3`. The multi-game request stored `UNSUPPORTED` / `UNSUPPORTED_MULTIGAME` with null rules. [Supported compile](https://explorer-studio.genlayer.com/tx/0x5a2d5c44f73d5bbc73aab8161f35d915ceba847d2ec8a16ee52ee783fd7e0888), [unsupported compile](https://explorer-studio.genlayer.com/tx/0x2558a11bad582e488e8582cc268bb0b988fa33ca1bbb66868c8b7dfb0aaef68b).

`quest-1` was activated successfully and currently has a scheduled window from `2026-09-30T06:45:30.173Z` to `2026-10-02T06:45:30.173Z`, with 25 DEMO reserved. [Activation receipt](https://explorer-studio.genlayer.com/tx/0x13a938331ee03e8861c1303b2cfe356d751e2f4fbf6c8412cb5c86b670b44d37). Deadline expiry/refund boundaries have not been exercised live.

The production Next.js build is deployed and READY at [clutch-genlayer.vercel.app](https://clutch-genlayer.vercel.app). Vercel SSO protection currently blocks public visitors; there is no custom domain on the project. A request to disable SSO was rejected by automatic approval review because that security-setting change needs explicit approval. This must be resolved before claiming the public frontend is accessible.

The user placed the deployment-bound challenge in the public bio of `wattxbt`. The [account-link transaction](https://explorer-studio.genlayer.com/tx/0x4b302a22770eead8fadc538fbb3bb740e9c79958652f96660690972dd024ef2e) finalized with successful execution and majority agreement, and the contract view confirmed that `wattxbt` is bound to the throwaway player wallet `0xF1E3457DD27470344B615343e991c6D30fc8BE91`. The bio text can now be removed. An attempted [enrollment before the play window](https://explorer-studio.genlayer.com/tx/0x7f6ed6c9b0e50903e875c0dd85bcd9cb746ffd7894ada7061a746500ec2f3b62) finalized with an execution error; `join_quest` requires the window to be open. No enrollment or fresh-game claim has succeeded, and no Portal entry has been submitted.

## Primary references

- [GenLayer networks](https://docs.genlayer.com/developers/networks)
- [GenLayer Studio environments](https://docs.genlayer.com/developers/intelligent-contracts/tools/genlayer-studio)
- [GenLayer deterministic transaction timestamps](https://docs.genlayer.com/developers/intelligent-contracts/features/transaction-context)
- [GenLayer web requests and independent validator fetching](https://docs.genlayer.com/developers/intelligent-contracts/features/web-access)
- [Lichess game export endpoint](https://github.com/lichess-org/api/blob/master/doc/specs/tags/games/game-export-gameId.yaml)
- [Lichess normalized game schema](https://github.com/lichess-org/api/blob/master/doc/specs/schemas/GameJson.yaml)
- [Lichess public user endpoint](https://github.com/lichess-org/api/blob/master/doc/specs/tags/users/api-user-username.yaml)
- [Lichess user/profile schema example](https://github.com/lichess-org/api/blob/master/doc/specs/examples/users-getUserPublicData.json.yaml)

## Local verification

On 2026-09-29, the workspace passed the local checks: GenVM lint (3 checks), schema generation (23 contract methods: 13 views and 10 writes), 38 source rule tests, ESLint, strict TypeScript, production build, browser smoke, and responsive browser checks at 390, 768, 1280, and 1440 pixels. The direct VM suite passed all 43 cases, including five deterministic lifecycle tests using mocked model/profile inputs and the pinned local runner. These tests validate the local simulator path; independent live validator agreement is separately evidenced above.

## Next live probe sequence

1. Resolve public frontend access by explicitly authorizing the Vercel SSO change for this project or supplying a custom domain.
2. After `2026-09-30T06:45:30.173Z`, enroll the verified `wattxbt` player wallet before any qualifying game starts.
3. Submit a newly played qualifying game that finishes before `2026-10-02T06:45:30.173Z`. Inspect the public evidence receipt and DEMO accounting.
4. Exercise the scheduled expiry/refund boundary after the active quest window, if still useful for the review.
