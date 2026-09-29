# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Next.js App Router, React, strict TypeScript, and a Python GenLayer Intelligent Contract. Use a project-local Python environment, pin runtime dependencies, and avoid a database unless implementation proves one is needed.

## Users

- Sponsors who describe a chess challenge, review its exact eligibility rules, and fund a demonstration reward.
- Chess players who link one Lichess account to one wallet, join a quest before playing, and submit a completed game.
- Wallet-free reviewers who inspect quests, rules, evidence, and receipts.

## Product Purpose

Clutch turns a sponsor's plain-language chess challenge into an inspectable quest. Independent validators agree on a small canonical rule set before play, then independently retrieve and normalize Lichess evidence after play. Deterministic contract code checks the frozen rules and settles one demonstration reward.

Success means a reviewer can follow the intended flow: compile, confirm, activate, link and join, verify a newly played game, and inspect the resulting award receipt.

## Positioning

Clutch puts an explicit, hash-bound checklist between natural-language intent and settlement. Its contract uses GenLayer consensus for rule interpretation and external game evidence, then uses ordinary deterministic code for eligibility and accounting.

## Operating Context

- Lichess is the only supported platform; standard chess is the only supported variant.
- A live claim is one completed game played after both quest activation and player enrollment.
- One successful claim can settle each quest. The first qualifying claim recorded on-chain wins; this does not promise the earliest game completed.
- Historical replay is a separate, reward-free sandbox and cannot qualify for a live quest.
- The supplied screenshot establishes the arcade mood, palette, and product controls. The quest map is an original visual interpretation, not a one-for-one copy of its island layout.
- Core copy: “Agree on the rules before the game. Verify the result afterward.”

## Capabilities and Constraints

- Supported quest conditions are a conjunction over Lichess, standard chess, rated state, speed, player color, win or draw, and an optional bounded maximum in half-moves.
- Vague, subjective, alternative, or out-of-schema requirements are clarified or rejected; no requirement may be silently dropped.
- Activation, expiry, enrollment, reward size, account binding, game timing, and settlement are enforced by contract code.
- Rewards are integer DEMO accounting units with no cash value. The app does not accept token deposits or promise real-money transfers.
- Browsing and proof inspection are wallet-free. State-changing actions require a wallet on the selected GenLayer Studio network.
- Lichess account control is checked by a temporary profile-bio challenge. This proves control at verification time, not who physically played or that a game is free from cheating.
- Dota, tournaments, player stakes, real-money escrow, multiple games per claim, marketplaces, reputation, and autonomous bots are out of scope.

## Brand Commitments

- Product name: CLUTCH.
- Tagline: “Turn a challenge into a quest.”
- Companion voice: playful and game-like, chosen by the user.
- Keep the playful game-map direction and focused mobile quest detail view. Let the quest map use original illustrated landmarks and terrain.

## Evidence on Hand

- The attached screenshot is a visual mood reference; the user explicitly asked for a more visual quest map instead of a literal copy.
- The public Lichess game and profile paths passed a test-only live validator probe on Studionet.
- Clutch 0.1.1 is deployed on Studionet, and supported/unsupported compiler paths and activation passed live consensus. A user-controlled account link and fresh post-activation game claim remain unverified.
- Do not invent players, completed quests, achievements, proof receipts, or deployment claims.

## Product Principles

- Translate requirements into a small, visible, hashable rule set.
- Keep model interpretation and external evidence inside independent consensus checks.
- Apply all balances and state changes in deterministic contract code after consensus.
- Show evidence, uncertainty, and operational failure clearly.
- Treat demonstration units as non-monetary and keep historical replay outside live settlement.

## Accessibility & Inclusion

- Support keyboard access, visible focus, labelled controls, readable contrast, 44px touch targets, non-color status cues, reduced motion, and responsive layouts at 390px and wider.
- Keep paragraph text in a readable non-pixel face; reserve pixel lettering for short headings and labels.
