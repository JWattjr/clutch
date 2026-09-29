# Rule schema: `clutch-rules/1`

## Canonical object

```json
{
  "platform": "LICHESS",
  "variant": "STANDARD",
  "rated": "ANY",
  "speed": "BLITZ",
  "player_color": "BLACK",
  "result": "WIN",
  "max_plies": 80
}
```

`max_plies` is optional. All other keys are required and unknown keys are rejected. `max_plies` is an integer from 1 to 400; booleans, floats, strings, zero, and out-of-range values are invalid.

| Field | Values |
|---|---|
| `platform` | `LICHESS` |
| `variant` | `STANDARD` |
| `rated` | `ANY`, `REQUIRED`, `FORBIDDEN` |
| `speed` | `ANY`, `BULLET`, `BLITZ`, `RAPID`, `CLASSICAL` |
| `player_color` | `ANY`, `WHITE`, `BLACK` |
| `result` | `WIN`, `DRAW` |
| `max_plies` | Optional integer, 1–400 |

All conditions are combined with AND. A win means the enrolled Lichess account is the game's recorded winner. A draw must have a recognized draw terminal status and no winner. `ANY` removes that one predicate; it does not remove evidence requirements.

## Move terminology

The API's space-separated `moves` value contains one token per half-move (ply). “40 full moves” compiles to `max_plies: 80`, shown to the sponsor as “Game ends within 80 half-moves (40 full moves).” The compiler must not guess if the wording or conversion is unclear. The sponsor confirms the resulting checklist hash before activation.

## Compilation outcomes

- `COMPILED`: canonical rules are present and fully schema-valid.
- `NEEDS_CLARIFICATION`: at least one phrase requires a bounded clarification; no rules are stored as compiled.
- `UNSUPPORTED`: at least one condition is outside the supported vocabulary or requires alternatives, subjectivity, multiple games, or another platform/variant.

Noncompiled output must contain one to three codes from this fixed list: `AMBIGUOUS_RESULT`, `VAGUE_SPEED`, `VAGUE_TIME_LIMIT`, `SUBJECTIVE_STRENGTH`, `SUBJECTIVE_QUALITY`, `UNSUPPORTED_ALTERNATIVE`, `UNSUPPORTED_CONDITION`, `UNSUPPORTED_MULTIGAME`, `UNSUPPORTED_OPPONENT`, `UNSUPPORTED_PLATFORM`, `UNSUPPORTED_RATING_THRESHOLD`, `UNSUPPORTED_VARIANT`, `MISSING_RESULT`, `MODEL_SCHEMA_INVALID`.

The model may omit `rules` on a noncompiled answer. Before validation, the contract fills that single omitted field with `null`; it still rejects unknown fields, malformed reason codes, or any non-null rules on a noncompiled result. A compiled answer must include a complete, schema-valid rules object. This narrow normalization was added after the first live unsupported compilation returned `UNSUPPORTED_MULTIGAME` without `rules`; the corrected `clutch/0.1.1` path passed the live supported and unsupported compilation checks.

Examples:

| Description | Outcome |
|---|---|
| “Win a rated blitz game as Black.” | `COMPILED`: rated required, blitz, black, win |
| “Draw a standard rapid game.” | `COMPILED`: any rated state, rapid, any color, draw |
| “Win in no more than 40 full moves.” | `COMPILED`: win, `max_plies: 80` |
| “Win quickly.” | `NEEDS_CLARIFICATION`: `VAGUE_TIME_LIMIT` |
| “Beat a strong player.” | `NEEDS_CLARIFICATION`: `SUBJECTIVE_STRENGTH` |
| “Play a brilliant game.” | `UNSUPPORTED`: `SUBJECTIVE_QUALITY` |
| “Win three games consecutively.” | `UNSUPPORTED`: `UNSUPPORTED_MULTIGAME` |
| “Win without blundering.” | `UNSUPPORTED`: `UNSUPPORTED_CONDITION` |
| “Win a game or solve a puzzle.” | `UNSUPPORTED`: `UNSUPPORTED_ALTERNATIVE` |

Independent interpretations compare the outcome status, every canonical rule value, and every reason code. Operational consensus failure is reported separately and never relabelled as clarification.

## Frozen Lichess source policy: `lichess-standard-live/1`

- Fetch only `https://lichess.org/game/export/{gameId}` with `Accept: application/json`.
- Require an eight-character alphanumeric game ID and require the returned ID to match.
- Accept only the standard variant and recognized finished categories: decisive games ending by mate, resignation, or timeout; draws ending as draw or stalemate.
- Exclude ongoing, aborted, imported, position-only, relay, unknown-source, and recognized bot-opponent games.
- Require stable player IDs, rated state, speed, start/completion times, terminal status, and move list for a live verdict.
- Keep only the fields needed to check identity, rule predicates, play-window times, and half-move count in the consensus tuple.
- A Lichess response can be stale, unavailable, or wrong; validator agreement is not independent proof of Lichess correctness or of fair play.
