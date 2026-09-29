---
name: Clutch
description: An arcade chess-quest board for inspecting challenges and public game evidence.
colors:
  canvas: "#111117"
  frame: "#1b2042"
  panel: "#22294e"
  panel-raised: "#2a315b"
  panel-dark: "#171c37"
  line: "#4a558f"
  line-soft: "#3d477c"
  ink: "#f0efff"
  action-ink: "#1f1c3d"
  ink-muted: "#acafd0"
  ink-dim: "#7f86ad"
  lavender: "#bb9cff"
  lavender-deep: "#9772e8"
  mint: "#75dfb6"
  quest-gold: "#ffd16a"
  coral: "#ff897f"
typography:
  display:
    fontFamily: '"Press Start 2P", "Lucida Console", Monaco, monospace'
    fontSize: "clamp(18px, 2.1vw, 25px)"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "-.08em"
  headline:
    fontFamily: '"Press Start 2P", "Lucida Console", Monaco, monospace'
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.6
    letterSpacing: "-.07em"
  title:
    fontFamily: '"IBM Plex Sans Variable", "Segoe UI", system-ui, sans-serif'
    fontSize: "14px"
    fontWeight: 700
    lineHeight: 1.5
  body:
    fontFamily: '"IBM Plex Sans Variable", "Segoe UI", system-ui, sans-serif'
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: '"Press Start 2P", "Lucida Console", Monaco, monospace'
    fontSize: "8px"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "-.04em"
rounded:
  tag: "5px"
  control: "7px"
  card: "9px"
  panel: "11px"
spacing:
  sm: "8px"
  md: "13px"
  lg: "18px"
  xl: "26px"
components:
  button-primary:
    backgroundColor: "{colors.lavender}"
    textColor: "{colors.action-ink}"
    typography: "{typography.title}"
    rounded: "{rounded.control}"
    padding: "0 11px"
    height: "44px"
  map-panel:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    rounded: "{rounded.panel}"
    padding: "19px"
  preview-tag:
    textColor: "{colors.lavender}"
    typography: "{typography.label}"
    rounded: "{rounded.tag}"
    padding: "4px 7px"
---

## Overview

Clutch is an arcade chess archipelago: a connected map makes time-control quests feel explorable, while the surrounding interface keeps their rules and state legible. Its character is playful, compact, and game-like, with a lilac knight companion and small pixel-lettered cues.

The user-supplied quest-map artboard is the visual authority. Carry its indigo frame, organic islands, dotted gold trails, and lavender, mint, gold, and coral state colors through the map, sponsor, and proof surfaces. Use readable sans-serif copy for instructions and evidence. The map is a designed working surface, not decoration for a generic finance dashboard.

## Colors

The frontmatter names the CSS custom properties from `app/globals.css`. `canvas`, `frame`, and the three panel tones form the dark field. `line` and `line-soft` carry borders and dividers; `ink` levels keep dense copy readable. Lavender marks active navigation and actions, mint marks ready or passing states, quest gold marks rewards and attention, and coral marks failed or mismatched states. Pair each color state with a label, icon, or shape.

## Typography

IBM Plex Sans Variable is the reading face for instructions, controls, forms, and evidence. Press Start 2P is reserved for the wordmark, short headings, compact labels, and map coordinates. Keep longer explanations in sans-serif. Both stacks include system fallbacks; do not let a missing display font prevent core content from reading.

## Layout

The app frame is capped at 1500px. Wide screens place the map and quest list beside a narrower account and companion rail. At 1120px the header reflows; at 860px the rail stacks below the map and the three map/sponsor/proof tabs appear in normal document flow between the hero and page content. At 560px the frame becomes full width, the header stays at the top, and map controls and cards form a single column. A 370px breakpoint further tightens the map. Keep the three island destinations and their connecting trail visible together whenever the viewport permits; prevent sticky controls from covering map markers or quest rows.

## Elevation & Depth

Use tonal panel layering, thin indigo borders, and restrained ambient shadow to separate surfaces. The islands carry the map's inset lower edge and soft ambient depth; quest emblems and primary actions use short shadows as tactile feedback. Generic panels stay flat. Avoid adding a repeated hard-offset shadow to every card.

## Shapes

Panels use compact rounded rectangles with small, consistent control corners. Tags and status chips are tighter. The islands are the deliberate organic shape: irregular oval silhouettes set apart from rectangular panels and controls. Focus remains visibly outlined in quest gold.

## Components

- **App frame and status bar:** The frame carries the brand, network/configuration state, DEMO balance, and wallet action. Keep the current connection state explicit.
- **Quest map:** A framed star field holds three colored islands, chess-piece markers, and a dotted gold route. Map/list toggle and time-control chips remain separate from destination selection.
- **Quest tiles and details:** Tiles show the quest name, time-control state, and preview/live status. The detail sheet explains challenge, timing, evidence, and next action without implying that preview quests can be joined.
- **Mobile navigation:** Map, sponsor, and proof tabs sit below the hero in normal flow on narrow screens. They must not obscure map content.
- **Sponsor desk and proof shelf:** Use the same panel and control language. The sponsor flow separates writing, compiling, and confirmation; the proof shelf makes public evidence inspectable.
- **Ollie companion:** Keep the knight character secondary to the board. Callouts are playful and short, grounded in the current configuration or the player's next action.
- **Preview and DEMO states:** Make sample content visibly a preview. DEMO amounts are explicitly non-cash and have no withdrawal value; do not style sample data as an earned reward.

## Do's and Don'ts

- **Do** keep the indigo arcade map, organic islands, dotted gold routes, and restrained pixel labels consistent across surfaces.
- **Do** use sans-serif type for paragraphs, forms, and receipts, with clear status wording beside color cues.
- **Do** preserve visible focus outlines, touch-sized controls, and the mobile tabs' non-overlapping placement.
- **Do** keep preview, DEMO, and live-contract states visually distinct and factually explicit.
- **Don't** use pixel type for long instructions or dense evidence.
- **Don't** add repeated offset shadows to generic panels or put fixed navigation over quest content.
- **Don't** imply that a preview creates a proof, badge, live reward, or cash balance.
