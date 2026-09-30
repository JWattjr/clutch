# Architecture

## Responsibility boundary

- **Browser:** wallet-free quest browsing, form validation, non-authoritative compiler preview labels, evidence views, wallet connection, and transaction progress. It does not decide a live claim or credit units.
- **GenLayer contract:** independently compiles sponsor text, validates canonical schemas, creates immutable profile challenges, freezes activation terms, records enrollment, fetches and normalizes Lichess game data under consensus, checks predicates deterministically, and settles conserved DEMO accounting.
- **Lichess:** source of public profile and game records. Validator agreement proves agreement about the retrieved response; it does not prove that Lichess data is complete or correct.
- **Indexer/database:** none in the MVP. Quest and receipt browsing comes from public contract views.

## Consensus boundary

1. `compile_draft` independently invokes the supported-language interpreter and compares the canonical status, rules, and bounded reason codes. Deterministic code then validates every schema key, enum, integer bound, and compilation outcome before changing draft state.
2. `verify_link_challenge` independently reads the exact stable user ID and bio challenge; state changes occur only after the agreed result returns. Wallet-owned links can also be read without a caller context through `get_link_for_wallet(wallet)`.
3. `submit_game` derives the allowlisted Lichess URL from an eight-character game ID. Each validator fetches the public JSON response and returns the same sorted, compact normalized tuple. Deterministic code checks all quest conditions and time constraints after agreement.
4. DEMO balance changes happen only in ordinary contract code after consensus. No LLM output, HTTP call, frontend preview, or signing prompt mutates state directly.

## Quest data and receipt

Quest records are stored as canonical JSON strings in a `TreeMap`, with an indexed `DynArray` of IDs. The state path is `DRAFT → COMPILED → ACTIVE → AWARDED | EXPIRED_REFUNDED`. Clarification and unsupported compilation results remain editable drafts. Draft edits clear rules and confirmation hashes.

The compiled checklist hash binds the description, schema version, canonical rules, source policy, DEMO reward, scheduled play-window start/end, claim grace, quest ID, chain ID, contract address, and sponsor. The sponsor sees the decoded checklist and confirms that exact hash in `confirm_and_activate`. The activation transaction records its deterministic transaction timestamp and freezes the record.

Enrollment stores the wallet, stable Lichess account ID, and enrollment timestamp as one immutable per-quest record. A successful claim stores its normalized evidence tuple hash, predicate results, settlement time, beneficiary, and DEMO amount. Failed and insufficient attempts remain publicly inspectable.

## Atomic accounting

Each wallet has an available DEMO balance. A one-time starter allocation is bounded and documented as non-Sybil-resistant. Activation moves reward units from available to reserved. Award moves the same units from reserved to the claimant's DEMO balance. Expiry moves them from reserved back to the sponsor. No method accepts token deposits or sends tokens. Every quest can settle only once.

## Public versus wallet-backed paths

Read-only views are callable without connecting a wallet. State-changing calls use an injected EIP-1193 wallet on Studionet (chain `61999`), and the client checks the account and chain before asking for a signature. The UI distinguishes wallet rejection, pending consensus, finalization with execution error, and successful finalized execution.

## External API operations

The contract permits only fixed Lichess URL prefixes. It never accepts a user-supplied URL, token, or arbitrary HTTP header. The game ID is checked before URL construction. The profile path is derived from a normalized Lichess ID. API response fields required for settlement are explicit; missing evidence is not coerced into a negative result.

## Separate automated BOT demo

The human UI remains connected to the deployed 0.1.1 contract. The new 0.2.0 source is deployed separately for an explicit casual BOT demo. `create_bot_demo_draft` freezes participant policy and an activation-relative window duration. The confirmation hash binds these terms; actual timestamps are set at activation, and the same hash remains stable afterward. Scheduled human drafts still use exact start/end times and exclude BOT games.

The local `scripts/bot-demo.ts` operator creates throwaway wallets, prepares a draft, validates exact compiled rules, links/enrolls the first BOT account, and plays both sides through Lichess's Bot API. Lichess credentials stay in a gitignored local file. The public **Bot demo** view reads only contract state. It has no game-start or transaction endpoint. The automated game is disclosed as scripted and casual; its receipt is distinct from human proofs. See [automated demo setup and live status](AUTOMATED_DEMO.md).
