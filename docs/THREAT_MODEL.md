# Threat model

## Assets

- Sponsor DEMO balances, reserved quest rewards, player DEMO balances, immutable quest rules, account bindings, and public claim receipts.
- Accurate display of transaction lifecycle and the final contract execution result.

## Trust boundaries

- **Lichess is an external source.** Validators independently retrieve the same source, but agreement cannot rule out incorrect, missing, delayed, or manipulated source data.
- **The model is untrusted.** It can only propose one object in a bounded schema; deterministic validation rejects unknown keys, enum values, bounds, malformed outcomes, and omitted/ambiguous conditions.
- **The browser is untrusted.** It may preview compilation but cannot write authoritative state or set claim eligibility.
- **Wallet signing is explicit.** The client checks account and chain immediately before signing; a wallet signature approves one stated contract call.
- **DEMO units are not money.** Starter balances are public and not Sybil-resistant; no token transfer or cash value exists.

## Main abuse cases and controls

| Threat | Control |
|---|---|
| Malicious or vague description is silently weakened | AND-only schema, fixed statuses/reason codes, independent canonical-field comparison, exact hash confirmation |
| Draft is edited after sponsor review | Any edit clears compilation and confirmation hash; activation recomputes the exact hash |
| Player claims a pre-activation or pre-enrollment game | Compare source `createdAt` against frozen activation and enrollment transaction timestamps |
| Account nonce is copied and stolen by another wallet | Challenge binds chain, contract, wallet, stable Lichess ID, and nonce; only the requesting wallet can complete; links cannot be reassigned |
| Two wallets bind one Lichess account | Global stable-ID-to-wallet mapping rejects duplicates |
| Lichess account is changed after enrollment | Enrollment freezes wallet and stable account ID; binding is immutable |
| User supplies a malicious URL | Contract constructs URLs only from an allowlisted Lichess host and validated ID |
| Missing API field is treated as failure/success | Missing essential fields yield `INSUFFICIENT_EVIDENCE`; no false/zero defaults |
| Player resubmits after insufficient evidence | Preserve attempt record; deterministic cooldown; permit retry after cooldown; do not permanently lock the game ID on an insufficient response |
| Two qualifying claims race, or claim races expiry | Contract state and reserved balance settle atomically; only `ACTIVE` can award or refund; first successful qualifying claim recorded wins |
| Sponsor attempts cancellation after activation | No cancellation transition exists |
| Recognized bot/imported/unallowed game is used | Frozen source/category policy excludes these records; unknown evidence is not assumed eligible |
| UI invents a successful reward | Live state is read from the contract; sandbox is visibly separate and cannot call settlement methods |
| Lichess returns inconsistent evidence to validators | Compare only canonical normalized settlement fields; disagreement leaves state unchanged and is shown as an operational consensus failure |

## Limits

- Account linking proves profile control when validators read the nonce; it does not prove who physically played.
- Lichess data cannot prove that a game was free of engine assistance or collusion. Clutch makes no anti-cheat guarantee.
- A match-level bot flag is not a cheating verdict. The policy only excludes accounts explicitly identified as bots in the exported game record.
- Public, repeatable starter allocations are not a Sybil-resistant monetary system.
- Validator agreement cannot prove the source API is truthful, complete, or continuously available.
- Studio deployments are demonstration deployments. The contract does not provide production escrow or real-money payment.
