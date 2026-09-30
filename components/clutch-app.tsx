"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  CHAIN_ID,
  CHAIN_ID_HEX,
  CONTRACT_ADDRESS,
  EXPLORER_URL,
  RPC_URL,
  checkRpcChain,
  hasContractAddress,
  readContract,
  writeContract,
  type Claim,
  type LinkChallenge,
  type Quest,
  type ReceiptProgress,
  type RuleSet,
  type Account,
} from "@/lib/contract";
import { replayGame, type ReplayResult } from "@/lib/replay";
import { isGameInput, parseGameId, SAVED_GAME } from "@/lib/lichess";
import { demoSchedule, EASY_DESCRIPTION, localDateInput, questPhase, remainingTime, scheduleError } from "@/lib/quest-state";
import { DialogFrame } from "./dialog-frame";
import { EvidenceChecks, GameEvidence } from "./game-evidence";

type ViewName = "explore" | "sponsor" | "proofs";
type NetworkState = "not-configured" | "checking" | "ready" | "error";
type LichessLink = { wallet: string; lichess_id: string };
type Enrollment = { enrolled?: boolean; wallet?: string; lichess_id?: string; enrolled_at_ms?: number };
type Toast = { kind: "success" | "error" | "info"; message: string };

const PREVIEW_QUESTS: Quest[] = [
  {
    id: "sample-blitz-grove", sponsor: "", description: "Win a rated blitz game as Black in no more than 40 full moves.",
    state: "PREVIEW", compile_status: "COMPILED", reason_codes: [],
    rules: { platform: "LICHESS", variant: "STANDARD", rated: "REQUIRED", speed: "BLITZ", player_color: "BLACK", result: "WIN", max_plies: 80 },
    rule_hash: "", reward: 0, starts_at_ms: 0, ends_at_ms: 0, activated_at_ms: 0, claim_deadline_ms: 0, claim_grace_ms: 0, winner: "", winning_claim_id: "", created_at_ms: 0,
  },
  {
    id: "sample-rapid-meadow", sponsor: "", description: "Draw a standard rapid game as White.",
    state: "PREVIEW", compile_status: "COMPILED", reason_codes: [],
    rules: { platform: "LICHESS", variant: "STANDARD", rated: "ANY", speed: "RAPID", player_color: "WHITE", result: "DRAW" },
    rule_hash: "", reward: 0, starts_at_ms: 0, ends_at_ms: 0, activated_at_ms: 0, claim_deadline_ms: 0, claim_grace_ms: 0, winner: "", winning_claim_id: "", created_at_ms: 0,
  },
  {
    id: "sample-classical-summit", sponsor: "", description: "Win a classical game with no move limit.",
    state: "PREVIEW", compile_status: "COMPILED", reason_codes: [],
    rules: { platform: "LICHESS", variant: "STANDARD", rated: "ANY", speed: "CLASSICAL", player_color: "ANY", result: "WIN" },
    rule_hash: "", reward: 0, starts_at_ms: 0, ends_at_ms: 0, activated_at_ms: 0, claim_deadline_ms: 0, claim_grace_ms: 0, winner: "", winning_claim_id: "", created_at_ms: 0,
  },
];

const GROUPS = [
  { speed: "BLITZ", name: "Blitz Grove", place: "woods", detail: "Rated and unrated" },
  { speed: "RAPID", name: "Rapid Meadow", place: "meadow", detail: "Room to think" },
  { speed: "CLASSICAL", name: "Classical Summit", place: "summit", detail: "Long-game quests" },
] as const;

const REASON_LABELS: Record<string, string> = {
  AMBIGUOUS_RESULT: "Name a win or a draw.",
  VAGUE_SPEED: "Choose a specific time control.",
  VAGUE_TIME_LIMIT: "Give an exact move limit.",
  SUBJECTIVE_STRENGTH: "Player strength cannot be checked by this quest.",
  SUBJECTIVE_QUALITY: "Subjective play quality is not supported.",
  UNSUPPORTED_ALTERNATIVE: "Use one set of conditions joined with “and”.",
  UNSUPPORTED_CONDITION: "That condition is outside Clutch’s supported rules.",
  UNSUPPORTED_MULTIGAME: "A quest can check one completed game.",
  UNSUPPORTED_OPPONENT: "Opponent-specific conditions are not supported.",
  UNSUPPORTED_PLATFORM: "This first version checks Lichess games only.",
  UNSUPPORTED_RATING_THRESHOLD: "Rating thresholds are not supported.",
  UNSUPPORTED_VARIANT: "This first version checks standard chess only.",
  MISSING_RESULT: "Say whether the player must win or draw.",
  MODEL_SCHEMA_INVALID: "The validators returned a rule shape Clutch cannot use.",
};

function compactAddress(address?: string): string {
  return address ? `${address.slice(0, 6)}…${address.slice(-4)}` : "Connect wallet";
}

function demo(value: number): string {
  return `${Number(value || 0).toLocaleString()} DEMO`;
}

function dateTime(value: number): string {
  return value ? new Date(value).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "Not set";
}

function useClock(): number {
  const [now, setNow] = useState(0);
  useEffect(() => {
    const firstTick = window.setTimeout(() => setNow(Date.now()), 0);
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => { window.clearTimeout(firstTick); window.clearInterval(timer); };
  }, []);
  return now;
}

function rulesText(rules: RuleSet): string[] {
  const output = [
    rules.result === "WIN" ? "Finish with a win" : "Finish with a draw",
    rules.rated === "REQUIRED" ? "Rated game" : rules.rated === "FORBIDDEN" ? "Unrated game" : "Rated or unrated",
    rules.speed === "ANY" ? "Any time control" : `${rules.speed[0]}${rules.speed.slice(1).toLowerCase()} time control`,
    rules.player_color === "ANY" ? "Play either color" : `Play as ${rules.player_color.toLowerCase()}`,
    "Standard Lichess chess",
  ];
  if (rules.max_plies != null) {
    const moves = rules.max_plies / 2;
    const count = Number.isInteger(moves) ? `${moves} full moves` : `${rules.max_plies} half-moves`;
    output.push(`Game ends within ${rules.max_plies} half-moves (${count})`);
  }
  return output;
}

function Icon({ name, size = 18 }: { name: "arrow" | "check" | "chess" | "close" | "copy" | "external" | "filter" | "list" | "map" | "plus" | "refresh" | "spark" | "wallet"; size?: number }) {
  const shared = { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true as const };
  if (name === "check") return <svg {...shared}><path d="m5 12 4 4L19 6" /></svg>;
  if (name === "close") return <svg {...shared}><path d="m6 6 12 12M18 6 6 18" /></svg>;
  if (name === "copy") return <svg {...shared}><rect x="8" y="8" width="11" height="12" rx="2" /><path d="M16 8V5a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h2" /></svg>;
  if (name === "external") return <svg {...shared}><path d="M14 4h6v6M20 4l-9 9" /><path d="M18 13v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h5" /></svg>;
  if (name === "filter") return <svg {...shared}><path d="M4 6h16M7 12h10m-7 6h4" /></svg>;
  if (name === "list") return <svg {...shared}><path d="M9 6h11M9 12h11M9 18h11" /><path d="M4 6h.01M4 12h.01M4 18h.01" /></svg>;
  if (name === "map") return <svg {...shared}><path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3z" /><path d="M9 3v15m6-12v15" /></svg>;
  if (name === "plus") return <svg {...shared}><path d="M12 5v14M5 12h14" /></svg>;
  if (name === "refresh") return <svg {...shared}><path d="M20 7v5h-5M4 17v-5h5" /><path d="M6.5 9A6 6 0 0 1 17 6l3 6M4 12l3 6a6 6 0 0 0 10.5-3" /></svg>;
  if (name === "spark") return <svg {...shared}><path d="m12 3 1.6 5.4L19 10l-5.4 1.6L12 17l-1.6-5.4L5 10l5.4-1.6zM19 16l.7 2.3L22 19l-2.3.7L19 22l-.7-2.3L16 19l2.3-.7z" /></svg>;
  if (name === "wallet") return <svg {...shared}><path d="M4 6.5A2.5 2.5 0 0 1 6.5 4H20v16H6a2 2 0 0 1-2-2z" /><path d="M4 7h16M16 12h4v4h-4a2 2 0 0 1 0-4Z" /></svg>;
  return <svg {...shared}><path d="M5 20h14M7 17l2-3h6l2 3M9 14l-1-4 2-2-1-3 3-2 3 3-1 3 2 3" /><path d="m10 7 2 1 2-1" /></svg>;
}

function StatePill({ state, quest }: { state: string; quest?: Quest }) {
  const now = useClock();
  const phase = quest ? questPhase(quest, now) : state;
  const labels: Record<string, string> = { ACTIVE: "Active", OPEN: "Open for play", UPCOMING: "Upcoming", CLAIMS_ONLY: "Claims only", DEADLINE_PASSED: "Deadline passed", CHECKING_TIME: "Checking time…", AWARDED: "Awarded", EXPIRED_REFUNDED: "Refunded", COMPILED: "Ready to confirm", DRAFT: "Draft", PREVIEW: "Preview only" };
  const label = labels[phase] ?? phase.replaceAll("_", " ");
  const tone = phase === "OPEN" || phase === "AWARDED" ? "mint" : phase === "EXPIRED_REFUNDED" || phase === "DEADLINE_PASSED" ? "coral" : ["COMPILED", "UPCOMING", "CLAIMS_ONLY"].includes(phase) ? "lavender" : "muted";
  return <span className={`state-pill ${tone}`}><span className="state-dot" aria-hidden="true" />{label}</span>;
}

function Brand() {
  return <div className="brand-mark" aria-label="Clutch home"><span className="brand-glyph">C</span><span>CLUTCH</span></div>;
}

function CompanionCard({ message, status }: { message: string; status: NetworkState }) {
  return <section className="panel companion-panel" aria-labelledby="companion-title">
    <div className="panel-kicker"><span className="eyebrow">YOUR QUEST MATE</span><span className="tiny-orbit" aria-hidden="true">✦</span></div>
    <div className="companion-content">
      <div className="sprite-frame"><Image src="/images/clutch-knight.png" alt="Ollie the lilac chess knight companion" width={88} height={88} priority /></div>
      <div><h2 id="companion-title">Ollie <span className="name-tag">LVL 1</span></h2><p className="companion-role">scout of the board</p></div>
    </div>
    <p className="companion-copy">{message}</p>
    {status === "not-configured" && <div className="companion-tip"><span aria-hidden="true">✦</span> Add a deployed contract address to open the live board.</div>}
  </section>;
}

function QuestTile({ quest, onSelect, compact = false }: { quest: Quest; onSelect: (quest: Quest) => void; compact?: boolean }) {
  const preview = quest.state === "PREVIEW";
  return <button className={`quest-tile ${compact ? "compact" : ""}`} type="button" onClick={() => onSelect(quest)}>
    <span className={`tile-token ${preview ? "preview-token" : quest.state === "AWARDED" ? "won-token" : ""}`} aria-hidden="true">♞</span>
    <span className="tile-main"><span className="tile-title">{quest.id.startsWith("sample-") ? quest.id === PREVIEW_QUESTS[0].id ? "Blitz Grove" : quest.id === PREVIEW_QUESTS[1].id ? "Rapid Meadow" : "Classical Summit" : quest.description}</span><span className="tile-subtitle">{preview ? "Example · no reward" : `${quest.rules?.speed ?? "Open"} · ${demo(quest.reward)}`}</span></span>
    <span className="tile-trailing">{preview ? <span className="mini-preview">PREVIEW</span> : <StatePill state={quest.state} quest={quest} />}<Icon name="arrow" size={16} /></span>
  </button>;
}

function QuestMap({
  quests, selectedSpeed, onChooseSpeed, onSelect, layout, onLayout, liveReady,
}: {
  quests: Quest[]; selectedSpeed: string; onChooseSpeed: (speed: string) => void; onSelect: (quest: Quest) => void;
  layout: "map" | "list"; onLayout: (layout: "map" | "list") => void; liveReady: boolean;
}) {
  const sampleBySpeed = new Map(PREVIEW_QUESTS.map((quest) => [quest.rules?.speed ?? "ANY", quest]));
  const mapQuests = quests.filter((quest) => ["ACTIVE", "AWARDED", "EXPIRED_REFUNDED"].includes(quest.state));
  const shown = liveReady
    ? mapQuests.filter((quest) => selectedSpeed === "ALL" || (quest.rules?.speed === selectedSpeed || quest.rules?.speed === "ANY"))
    : PREVIEW_QUESTS.filter((quest) => selectedSpeed === "ALL" || quest.rules?.speed === selectedSpeed);

  return <section className="panel map-panel" aria-labelledby="map-title">
    <div className="panel-heading map-heading">
      <div><h1 id="map-title">Quest map</h1><p className="heading-note">Travel the chess world. Choose a destination to find its quests.</p></div>
      <div className="view-toggle" role="group" aria-label="Quest map layout">
        <button type="button" aria-pressed={layout === "map"} onClick={() => onLayout("map")}><Icon name="map" size={15} /> Map</button>
        <button type="button" aria-pressed={layout === "list"} onClick={() => onLayout("list")}><Icon name="list" size={15} /> List</button>
      </div>
    </div>
    <div className={`board-body ${layout === "list" ? "list-layout" : ""}`}>
      {layout === "map" && <div className="map-experience">
        <div className="map-stage" role="group" aria-label="Illustrated quest map grouped by time control">
          <div className="map-canvas">
            <Image src="/images/quest-map-world.png" alt="" fill sizes="(max-width: 560px) 840px, (max-width: 860px) 720px, (max-width: 1200px) 900px, 1100px" quality={75} loading="eager" fetchPriority="high" className="map-world-image" />
            <div className="map-destinations">
              {GROUPS.map((group) => {
                const trailQuests = liveReady ? mapQuests.filter((item) => (item.rules?.speed === group.speed || item.rules?.speed === "ANY")) : PREVIEW_QUESTS.filter((item) => item.rules?.speed === group.speed);
                const quest = liveReady ? trailQuests[0] : sampleBySpeed.get(group.speed);
                const count = trailQuests.length;
                const active = selectedSpeed === group.speed;
                const opensQuest = count === 1 && Boolean(quest);
                return <button key={group.speed} className={`map-destination destination-${group.place} ${active ? "selected" : ""}`} type="button" aria-pressed={active} aria-label={`${group.name}: ${count} ${liveReady ? "live" : "sample"} ${count === 1 ? "quest" : "quests"}. ${opensQuest ? liveReady ? "Open quest details" : "View example details" : "Browse this trail"}`} onClick={() => { onChooseSpeed(group.speed); if (opensQuest && quest) onSelect(quest); }}>
                  <span className="destination-pin" aria-hidden="true" />
                  <span className="destination-plaque">
                    <span className="destination-name">{group.name}</span>
                    <span className="destination-detail">{group.detail}</span>
                    <span className="destination-bottom"><span className="destination-count">{liveReady ? `${count} ${count === 1 ? "quest" : "quests"}` : `${count} ${count === 1 ? "sample" : "samples"}`}</span><span className="destination-action">{opensQuest ? liveReady ? "Open quest" : "View example" : "Browse trail"}</span></span>
                  </span>
                </button>;
              })}
            </div>
          </div>
        </div>
        <p className="map-caption"><span>{liveReady ? "Live quests · grouped by time control" : "Sample world · examples have no live reward"}</span><span className="map-swipe-hint">Scroll sideways to explore the map</span></p>
      </div>}
      <div className="quest-list-area">
        <div className="filter-row"><span className="section-label"><Icon name="filter" size={15} /> BROWSE BY TIME</span><div className="filter-chips" role="group" aria-label="Filter by time control">
          {["ALL", "BLITZ", "RAPID", "CLASSICAL"].map((speed) => <button key={speed} type="button" className={selectedSpeed === speed ? "active" : ""} aria-pressed={selectedSpeed === speed} onClick={() => onChooseSpeed(speed)}>{speed === "ALL" ? "All trails" : speed}</button>)}
        </div></div>
        {shown.length > 0 ? <div className="quest-list">{shown.map((quest) => <QuestTile key={quest.id} quest={quest} onSelect={onSelect} />)}</div> : <div className="empty-inline"><span className="empty-icon">♘</span><div><strong>No {selectedSpeed.toLowerCase()} quests yet.</strong><p>Check another trail or open the sponsor desk to post one.</p></div></div>}
        {!liveReady && <p className="preview-note"><span aria-hidden="true">i</span> These examples show the layout and supported rule shapes. They cannot be joined or paid.</p>}
      </div>
    </div>
  </section>;
}

function ActivityPanel({ claims, loading, onSelectClaim, liveReady }: { claims: Claim[]; loading: boolean; onSelectClaim: (claim: Claim) => void; liveReady: boolean }) {
  const latest = claims.slice().sort((a, b) => (b.submitted_at_ms ?? 0) - (a.submitted_at_ms ?? 0)).slice(0, 3);
  return <section className="panel activity-panel" aria-labelledby="activity-title">
    <div className="panel-heading compact-heading"><div><h2 id="activity-title">Quest log</h2></div><span className="count-note">{claims.length} {claims.length === 1 ? "claim" : "claims"}</span></div>
    {loading ? <div className="loading-line"><span className="spinner" /> Reading public receipts…</div> : latest.length ? <div className="activity-list">{latest.map((claim) => <button type="button" className="activity-row" key={claim.id} onClick={() => onSelectClaim(claim)}>
      <span className={`activity-mark ${claim.outcome === "VERIFIED" ? "passed" : claim.outcome === "NOT_QUALIFIED" ? "failed" : "waiting"}`}>{claim.outcome === "VERIFIED" ? <Icon name="check" size={15} /> : "·"}</span>
      <span className="activity-copy"><strong>{claim.outcome === "VERIFIED" ? "Quest cleared" : claim.outcome === "NOT_QUALIFIED" ? "Try another game" : "Evidence needs a retry"}</strong><small>{claim.game_id} · {dateTime(claim.submitted_at_ms)}</small></span>
      <span className="activity-reward">{claim.reward_demo_units ? `+${demo(claim.reward_demo_units)}` : claim.outcome}</span>
    </button>)}</div> : <div className="empty-log"><span className="empty-icon">♙</span><p>{liveReady ? "Select a quest to inspect its public claim history." : "A quest log appears when this board is connected."}</p><span>No XP or badges are invented for this preview.</span></div>}
    <div className="receipt-link-row"><span><span className="mint-dot" /> Receipts are public</span><a href="#proofs" onClick={(event) => { event.preventDefault(); document.dispatchEvent(new CustomEvent("clutch:navigate", { detail: "proofs" })); }}>Open proof shelf <Icon name="arrow" size={14} /></a></div>
  </section>;
}

function ProofShelf({ claims, loading, onSelect }: { claims: Claim[]; loading: boolean; onSelect: (claim: Claim) => void }) {
  if (loading) return <div className="proof-empty"><span className="spinner" /><p>Reading public proof receipts…</p></div>;
  if (!claims.length) return <div className="proof-empty"><div className="proof-empty-icon">♙</div><h3>No proof receipts yet</h3><p>Clutch only lists claims recorded by the configured contract. Sample quests never create receipts.</p></div>;
  return <div className="proof-grid">{claims.map((claim) => <button className="proof-card" type="button" key={claim.id} onClick={() => onSelect(claim)}>
    <span className={`proof-stamp ${claim.outcome === "VERIFIED" ? "mint" : claim.outcome === "NOT_QUALIFIED" ? "coral" : "yellow"}`}>{claim.outcome === "VERIFIED" ? "VERIFIED" : claim.outcome === "NOT_QUALIFIED" ? "NOT QUALIFIED" : "NEEDS EVIDENCE"}</span>
    <strong>{claim.quest_id}</strong><span>Game {claim.game_id}</span><span>{dateTime(claim.submitted_at_ms)}</span>
    <span className="proof-card-bottom"><span>{claim.outcome === "VERIFIED" ? "All award checks passed" : `${claim.checks?.filter((check) => check.status !== "PASS").length ?? 0} checks need attention`}</span><span>{claim.reward_demo_units ? `+${demo(claim.reward_demo_units)}` : "0 reward"}</span></span>
  </button>)}</div>;
}

function RulesChecklist({ rules }: { rules: RuleSet }) {
  return <ul className="rules-checklist">{rulesText(rules).map((line) => <li key={line}><span className="check-box"><Icon name="check" size={12} /></span><span>{line}</span></li>)}</ul>;
}

function QuestDetail({
  quest, preview, liveReady, wallet, chainId, link, challenge, enrollment, claims, busy, onClose, onConnect, onSwitchNetwork,
  onRequestLink, onVerifyLink, onJoin, onSubmit, onExpire, onSelectClaim, detailsLoading, detailsError, onRetryDetails, toast, receipt,
}: {
  quest: Quest; preview: boolean; liveReady: boolean; wallet?: string; chainId?: number; link: LichessLink | null;
  challenge: LinkChallenge | null; enrollment: Enrollment | null; claims: Claim[]; busy: string;
  onClose: () => void; onConnect: () => void; onSwitchNetwork: () => void;
  onRequestLink: (lichessId: string) => Promise<void>; onVerifyLink: () => Promise<void>; onJoin: () => Promise<void>;
  onSubmit: (gameId: string) => Promise<void>; onExpire: () => Promise<void>; onSelectClaim: (claim: Claim) => void;
  detailsLoading: boolean; detailsError: string; onRetryDetails: () => void; toast: Toast | null; receipt: ReceiptProgress | null;
}) {
  const [lichessId, setLichessId] = useState("");
  const [replayId, setReplayId] = useState(preview ? SAVED_GAME.id : "");
  const [replayUser, setReplayUser] = useState(preview ? SAVED_GAME.player : "");
  const [replay, setReplay] = useState<ReplayResult | null>(null);
  const [replayBusy, setReplayBusy] = useState(false);
  const [replayError, setReplayError] = useState("");
  const [copied, setCopied] = useState(false);
  const [replayOpen, setReplayOpen] = useState(preview);
  const isActive = quest.state === "ACTIVE";
  const now = useClock();
  const phase = questPhase(quest, now);
  const canJoinNow = isActive && now >= quest.starts_at_ms && now <= quest.ends_at_ms;
  const canClaimNow = isActive && now > 0 && now <= quest.claim_deadline_ms;
  const currentLink = link?.lichess_id ? link : null;
  const recentClaim = claims.slice().sort((a, b) => (b.submitted_at_ms ?? 0) - (a.submitted_at_ms ?? 0))[0];
  const isWrongNetwork = Boolean(wallet && chainId !== CHAIN_ID);
  const timeZone = now ? Intl.DateTimeFormat().resolvedOptions().timeZone : "your local timezone";
  const nextMove = preview ? "Scout a saved game" : phase === "AWARDED" ? "Inspect the winning receipt" : phase === "EXPIRED_REFUNDED" ? "Choose a new quest" : phase === "DEADLINE_PASSED" ? "This quest’s claim deadline has passed" : phase === "CHECKING_TIME" ? "Checking the quest clock…" : !wallet ? "Connect your wallet when you’re ready to play" : isWrongNetwork ? "Switch to Studio Net" : !liveReady ? "Retry the board connection" : detailsLoading ? "Reading your checkpoint…" : detailsError ? "Retry your checkpoint" : !currentLink ? "Link your Lichess account" : phase === "UPCOMING" ? `Play opens in ${remainingTime(quest.starts_at_ms, now)}` : !enrollment?.enrolled ? phase === "OPEN" ? "Join before starting a game" : "You missed enrollment; choose an open quest" : phase === "CLAIMS_ONLY" ? "Submit a game you finished inside the play window" : "Finish a qualifying game, then find it here";

  async function copyChallenge() {
    if (!challenge?.text) return;
    await navigator.clipboard.writeText(challenge.text);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  async function runReplay(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!quest.rules) return;
    setReplay(null); setReplayError(""); setReplayBusy(true);
    try { setReplay(await replayGame(replayId.trim(), quest.rules, replayUser)); }
    catch (error) { setReplayError(error instanceof Error ? error.message : String(error)); }
    finally { setReplayBusy(false); }
  }

  async function runSavedReplay() {
    if (!quest.rules || replayBusy) return;
    setReplayId(SAVED_GAME.id); setReplayUser(SAVED_GAME.player); setReplayOpen(true);
    setReplay(null); setReplayError(""); setReplayBusy(true);
    try { setReplay(await replayGame(SAVED_GAME.id, quest.rules, SAVED_GAME.player)); }
    catch (error) { setReplayError(error instanceof Error ? error.message : String(error)); }
    finally { setReplayBusy(false); }
  }

  return <DialogFrame titleId="quest-detail-title" onClose={onClose}>
    <section className="quest-sheet">
      <header className="sheet-top"><span className="eyebrow">{preview ? "SAMPLE EXPEDITION" : `QUEST ${quest.id}`}</span><button className="icon-button" type="button" aria-label="Close quest details" onClick={onClose}><Icon name="close" /></button></header>
      <div className="sheet-scroll">
        <div className="next-move"><h3>Your next move</h3><p>{nextMove}</p>{!preview && now > 0 && ["OPEN", "CLAIMS_ONLY"].includes(phase) && <small>{phase === "OPEN" ? `Play closes in ${remainingTime(quest.ends_at_ms, now)}` : `Claims close in ${remainingTime(quest.claim_deadline_ms, now)}`}</small>}</div>
        {toast && <div className={`sheet-feedback ${toast.kind}`} role={toast.kind === "error" ? "alert" : "status"}><p>{toast.message}</p>{receipt && <a href={`${EXPLORER_URL}/tx/${receipt.hash}`} target="_blank" rel="noreferrer">{receipt.status} · Inspect transaction ↗</a>}</div>}
        <div className="sheet-title-row"><div className="sheet-emblem" aria-hidden="true">♞</div><div className="sheet-title-copy"><StatePill state={quest.state} quest={quest} /><h2 id="quest-detail-title">{quest.description}</h2><p>{preview ? "Example quest · no funds reserved" : `Posted by ${compactAddress(quest.sponsor)}`}</p></div></div>
        <div className="quest-reward-card"><div><span className="eyebrow">DEMO REWARD</span><strong>{preview ? "—" : demo(quest.reward)}</strong></div><div className="reward-lock"><span className="status-square" />{preview ? "Preview only" : quest.state === "ACTIVE" ? "Reserved by sponsor" : quest.state === "AWARDED" ? "Settled once" : quest.state === "EXPIRED_REFUNDED" ? "Returned to sponsor" : "Not reserved"}</div></div>

        <section className="detail-block"><div className="block-title"><span className="step-number">01</span><div><span className="eyebrow">THE RULES</span><h3>What counts as a clear?</h3></div></div>
          {quest.rules ? <RulesChecklist rules={quest.rules} /> : <div className="rule-status"><strong>{quest.compile_status || "Still a draft"}</strong><p>{(quest.reason_codes ?? []).map((code) => REASON_LABELS[code] ?? code).join(" ") || "The sponsor has not compiled this quest yet."}</p></div>}
          {!preview && quest.rule_hash && <details className="evidence-drawer"><summary>Inspect checklist hash and source policy</summary><div className="drawer-content"><span>Rule hash</span><code>{quest.rule_hash}</code><span>Source policy</span><code>lichess-standard-live/1 · rules clutch-rules/1</code></div></details>}
        </section>

        <section className="detail-block timing-block"><div className="block-title"><span className="step-number">02</span><div><span className="eyebrow">PLAY WINDOW</span><h3>When the quest is open</h3></div></div><div className="timing-grid"><div><span>Opens</span><strong>{preview ? "Not scheduled" : dateTime(quest.starts_at_ms)}</strong></div><div><span>Closes</span><strong>{preview ? "Not scheduled" : dateTime(quest.ends_at_ms)}</strong></div><div><span>Claim deadline</span><strong>{preview ? "—" : dateTime(quest.claim_deadline_ms)}</strong></div></div><p className="fine-print">Times shown in {timeZone}. Join during the play window, then start and finish your game before play closes. Submit before the separate claim deadline. The first qualifying claim recorded on-chain wins.</p></section>

        {preview ? <section className="detail-block sandbox-block"><div className="block-title"><span className="step-number">↗</span><div><span className="eyebrow">HISTORICAL REPLAY</span><h3>Try a real game record</h3></div></div><div className="sandbox-banner"><span>REPLAY / SANDBOX</span><p>This checks a public historical game in your browser. It cannot join a quest or credit DEMO units.</p></div><ReplayForm replayOpen={replayOpen} onToggle={() => setReplayOpen(!replayOpen)} replayId={replayId} setReplayId={setReplayId} replayUser={replayUser} setReplayUser={setReplayUser} replay={replay} replayBusy={replayBusy} replayError={replayError} onSubmit={runReplay} onSavedGame={() => void runSavedReplay()} /></section> : <section className="detail-block player-block"><div className="block-title"><span className="step-number">03</span><div><span className="eyebrow">PLAYER CHECKPOINT</span><h3>Link, join, then play</h3></div></div>
          {!wallet ? <div className="action-card"><p>Connect a wallet on GenLayer Studio Net to take a turn.</p><button className="button-primary" type="button" onClick={onConnect}><Icon name="wallet" size={16} /> Connect wallet</button></div>
            : isWrongNetwork ? <div className="action-card"><p>Your wallet is on chain {chainId ?? "unknown"}. Clutch reads and writes on Studio Net ({CHAIN_ID}).</p><button className="button-primary" type="button" onClick={onSwitchNetwork}>Switch to Studio Net</button></div>
              : !liveReady ? <div className="action-card"><p>Clutch can’t read the configured contract right now. On-chain actions are paused until the board is available.</p></div>
                : ["AWARDED", "EXPIRED_REFUNDED", "DEADLINE_PASSED", "CHECKING_TIME"].includes(phase) ? <div className="action-card"><p>{nextMove}. Player submissions are closed.</p>{phase === "DEADLINE_PASSED" && <button className="button-secondary" type="button" disabled={Boolean(busy)} onClick={() => void onExpire()}>Refund expired quest</button>}</div>
                : detailsLoading ? <p role="status">Reading enrollment and receipts…</p>
                : detailsError ? <div className="action-card"><p role="alert">{detailsError}</p><button type="button" className="button-secondary" onClick={onRetryDetails}>Retry checkpoint</button></div>
                : !currentLink ? <div className="action-card"><p>Link the Lichess account that will play this quest. The link is fixed to this wallet.</p>{challenge?.state === "PENDING" ? <div className="challenge-box"><span className="eyebrow">ADD THIS EXACT LINE TO YOUR PUBLIC BIO</span><code>{challenge.text}</code><div className="challenge-actions"><a href={`https://lichess.org/@/${challenge.lichess_id}`} target="_blank" rel="noreferrer">Open Lichess profile <Icon name="external" size={14} /></a><button type="button" className="text-button" onClick={() => void copyChallenge()}><Icon name="copy" size={14} /> {copied ? "Copied" : "Copy text"}</button></div><p>Leave it there until the verification transaction finalizes. Then you can remove it.</p><button className="button-secondary full-width" type="button" disabled={Boolean(busy)} onClick={() => void onVerifyLink()}>{busy || "Check profile and link"}</button></div>
                  : <form className="inline-form" onSubmit={(event) => { event.preventDefault(); void onRequestLink(lichessId); }}><label htmlFor="lichess-id">Lichess username</label><div className="input-with-prefix"><span>@</span><input id="lichess-id" value={lichessId} onChange={(event) => setLichessId(event.target.value)} minLength={3} maxLength={30} autoComplete="username" required pattern="[A-Za-z0-9_-]{3,30}" placeholder="yourname" /></div><p className="field-help">Clutch checks the public profile bio. It never asks you for a Lichess password or token.</p><button className="button-primary" type="submit" disabled={Boolean(busy) || !lichessId.trim()}>{busy || "Get a profile challenge"}</button></form>}</div>
                : !enrollment?.enrolled && canJoinNow ? <div className="action-card"><div className="linked-row"><span className="linked-check"><Icon name="check" size={14} /></span><span><strong>@{currentLink.lichess_id}</strong><small>Linked to {compactAddress(wallet)}</small></span></div><p>Your account link is verified. Join now so a game must start after your enrollment.</p><button className="button-primary" type="button" disabled={Boolean(busy)} onClick={() => void onJoin()}>{busy || "Join this quest"}</button></div>
                  : enrollment?.enrolled && canClaimNow ? <div className="action-card"><div className="linked-row"><span className="linked-check"><Icon name="check" size={14} /></span><span><strong>Joined as @{enrollment.lichess_id}</strong><small>Joined {dateTime(enrollment.enrolled_at_ms ?? 0)}</small></span></div><p>Finish a qualifying game, find it here, and check it before signing.</p><GameEvidence quest={quest} username={enrollment.lichess_id ?? currentLink.lichess_id} enrolledAt={enrollment.enrolled_at_ms ?? 0} canSubmit={canClaimNow} busy={busy} onSubmit={onSubmit} /></div>
                    : <div className="action-card"><p>{isActive && now < quest.starts_at_ms ? `This quest opens ${dateTime(quest.starts_at_ms)}. You can join when the play window begins.` : isActive && now > quest.ends_at_ms ? "The play window has closed. Players who enrolled in time can still submit through the claim grace period." : `This quest is ${quest.state.toLowerCase().replaceAll("_", " ")}. Player actions are closed.`}</p>{quest.state === "ACTIVE" && now > quest.claim_deadline_ms && <button className="button-secondary" type="button" disabled={Boolean(busy)} onClick={() => void onExpire()}>{busy || "Refund expired quest"}</button>}</div>}
        </section>}

        {recentClaim && <section className="detail-block claim-block"><div className="block-title"><span className="step-number">04</span><div><span className="eyebrow">LATEST CLAIM RECEIPT</span><h3>{recentClaim.outcome === "VERIFIED" ? "Quest cleared!" : recentClaim.outcome === "NOT_QUALIFIED" ? "This game missed a rule" : "Some evidence is missing"}</h3></div></div><p className="claim-intro">Game <a href={`https://lichess.org/${recentClaim.game_id}`} target="_blank" rel="noreferrer">{recentClaim.game_id} <Icon name="external" size={13} /></a> · {recentClaim.reward_demo_units ? `+${demo(recentClaim.reward_demo_units)}` : "no reward credited"}</p><EvidenceChecks checks={recentClaim.checks} /><p className="field-help">{recentClaim.outcome === "VERIFIED" ? "The single quest reward was settled." : recentClaim.outcome === "NOT_QUALIFIED" ? "These conditions did not match. If claims are still open, select another qualifying game." : "Validators could not obtain enough evidence. Inspect the receipt and retry while claims remain open."}</p><details className="evidence-drawer"><summary>Inspect public evidence hash and claim ID</summary><div className="drawer-content"><span>Claim ID</span><code>{recentClaim.id}</code><span>Evidence hash</span><code>{recentClaim.evidence_hash}</code></div></details><button type="button" className="text-button open-receipt" onClick={() => onSelectClaim(recentClaim)}>Open full receipt <Icon name="arrow" size={14} /></button></section>}

        {!preview && quest.rules && <section className="detail-block sandbox-block live-replay-block"><button className="replay-toggle" type="button" aria-expanded={replayOpen} onClick={() => setReplayOpen(!replayOpen)}><span><strong>Replay a historical game</strong><small>Sandbox · no reward. Review rules without touching this quest.</small></span><span className="toggle-plus">{replayOpen ? "−" : "+"}</span></button>{replayOpen && <ReplayForm replayOpen replayId={replayId} setReplayId={setReplayId} replayUser={replayUser} setReplayUser={setReplayUser} replay={replay} replayBusy={replayBusy} replayError={replayError} onSubmit={runReplay} onSavedGame={() => void runSavedReplay()} />}</section>}

        <div className="sheet-footnote"><span className="mint-dot" /> Validators agree on the public Lichess record; Lichess remains the source of that data.</div>
      </div>
    </section>
  </DialogFrame>;
}

function ReplayForm({ replayOpen, onToggle, replayId, setReplayId, replayUser, setReplayUser, replay, replayBusy, replayError, onSubmit, onSavedGame }: {
  replayOpen: boolean; onToggle?: () => void; replayId: string; setReplayId: (value: string) => void; replayUser: string; setReplayUser: (value: string) => void;
  replay: ReplayResult | null; replayBusy: boolean; replayError: string; onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
  onSavedGame: () => void;
}) {
  return <div className="replay-area">
    <button type="button" className="button-secondary full-width" disabled={replayBusy} onClick={onSavedGame}>Replay Wattxbt’s saved game</button>
    <p className="field-help">A real historical game. It can show passing and failed rules, depending on this quest. It never earns a reward.</p>
    {onToggle && <button type="button" className="text-button replay-disclosure" aria-expanded={replayOpen} onClick={onToggle}>Historical games cannot claim a live reward {replayOpen ? "−" : "+"}</button>}
    {replayOpen && <><form className="inline-form replay-form" onSubmit={onSubmit}><label htmlFor="historical-game-id">Game link or ID</label><input id="historical-game-id" value={replayId} onChange={(event) => setReplayId(event.target.value)} required maxLength={200} readOnly={replayBusy} placeholder="Paste a Lichess link or game ID" /><label htmlFor="historical-player-id">Player account to check</label><input id="historical-player-id" value={replayUser} onChange={(event) => setReplayUser(event.target.value)} readOnly={replayBusy} required minLength={3} maxLength={30} pattern="[A-Za-z0-9_-]{3,30}" placeholder="Lichess username" /><button className="button-secondary" type="submit" disabled={replayBusy || !isGameInput(replayId) || !replayUser.trim()}>{replayBusy ? "Reading Lichess…" : "Replay game"}</button></form>
      {replayError && <p className="inline-error" role="alert">{replayError}</p>}{replay && <div className="replay-result" role="status"><div className="replay-result-heading"><span className={`replay-result-badge ${replay.status.toLowerCase()}`}>{replay.status === "MATCHES_RULES" ? "RULES MATCH" : replay.status === "DOES_NOT_MATCH" ? "RULES DIFFER" : "NEEDS EVIDENCE"}</span><span>GAME {replay.gameId}</span></div><EvidenceChecks checks={replay.checks} /><p className="field-help">{replay.note}</p></div>}</>}
  </div>;
}

function SponsorDesk({
  wallet, account, quests, busy, canWrite, blockMessage, onCreate, onCompile, onActivate, onSelect, onConnect,
}: {
  wallet?: string; account: Account | null; quests: Quest[]; busy: string; canWrite: boolean; blockMessage: string;
  onCreate: (data: { description: string; reward: number; starts: number; ends: number }) => Promise<void>;
  onCompile: (quest: Quest) => Promise<void>; onActivate: (quest: Quest) => Promise<void>; onSelect: (quest: Quest) => void;
  onConnect: () => void;
}) {
  const [description, setDescription] = useState("");
  const [reward, setReward] = useState("25");
  const [starts, setStarts] = useState("");
  const [ends, setEnds] = useState("");
  const [formError, setFormError] = useState("");
  const [timeZone, setTimeZone] = useState("your local timezone");
  const now = useClock();
  useEffect(() => { const timer = window.setTimeout(() => setTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone), 0); return () => window.clearTimeout(timer); }, []);
  const [approved, setApproved] = useState<Record<string, boolean>>({});
  const drafts = quests.filter((quest) => quest.sponsor?.toLowerCase() === wallet?.toLowerCase() && ["DRAFT", "COMPILED"].includes(quest.state)).sort((a, b) => b.created_at_ms - a.created_at_ms);

  async function createDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const startTime = new Date(starts).getTime(); const endTime = new Date(ends).getTime();
    const error = scheduleError(startTime, endTime, Date.now());
    setFormError(error);
    if (error) return;
    await onCreate({ description: description.trim(), reward: Number.parseInt(reward, 10), starts: startTime, ends: endTime });
  }

  function applyPreset(hours: number) {
    const schedule = demoSchedule(hours);
    setDescription(EASY_DESCRIPTION); setReward("1"); setStarts(localDateInput(schedule.starts)); setEnds(localDateInput(schedule.ends)); setFormError("");
  }

  return <div className="sponsor-layout">
    <section className="panel sponsor-intro"><span className="eyebrow">SPONSOR DESK · QUEST MAKER</span><h1>Set the challenge.<br /><em>Let the board decide.</em></h1><p>Write one chess condition in everyday language. Validators independently compile it into a small checklist, then you approve the exact rules before any DEMO units are reserved.</p><div className="sponsor-flow"><span><b>1</b> Describe</span><i>→</i><span><b>2</b> Compile</span><i>→</i><span><b>3</b> Confirm &amp; post</span></div></section>
    <div className="sponsor-columns"><section className="panel sponsor-form-panel"><div className="panel-heading"><div><span className="eyebrow">NEW EXPEDITION</span><h2>Write a chess quest</h2></div><span className="demo-coin">◆ DEMO</span></div>
      <div className="demo-preset"><h3>Make the demo easy</h3><p>A casual standard draw, either color, any time control, no move limit. 1 DEMO. Starts in 30 minutes to allow compilation and activation.</p><div className="game-actions"><button type="button" className="button-secondary" disabled={Boolean(busy)} onClick={() => applyPreset(24)}>Use 24-hour preset</button><button type="button" className="button-secondary" disabled={Boolean(busy)} onClick={() => applyPreset(48)}>Use 48-hour preset</button></div><small>Two human players. Join before playing. No Lichess bots.</small></div>
      {!canWrite && <div className="sponsor-wallet-note"><span className="wallet-illustration"><Icon name={wallet ? "spark" : "wallet"} size={23} /></span><strong>{wallet ? "Sponsor actions are paused" : "Connect your wallet to sponsor"}</strong><p>{blockMessage || "You can still review public quests and receipts without one."}</p>{!wallet && <button type="button" className="button-primary" onClick={onConnect}>Connect wallet</button>}</div>}<form className="sponsor-form" onSubmit={createDraft}>
        <label htmlFor="quest-prompt">Challenge description</label><textarea id="quest-prompt" value={description} onChange={(event) => setDescription(event.target.value)} maxLength={1000} minLength={8} required placeholder="Win a rated blitz game as Black in no more than 40 full moves." /><div className="field-under"><span>Try: win/draw · rated · blitz/rapid/classical · color · move limit</span><span>{description.length}/1000</span></div>
        <div className="form-grid"><div><label htmlFor="quest-reward">Reward units</label><div className="unit-input"><input id="quest-reward" type="number" min={1} max={1000} step={1} value={reward} onChange={(event) => setReward(event.target.value)} required /><span>DEMO</span></div><small>Up to 1,000 DEMO · no cash value</small></div><div className="available-balance"><span>YOUR AVAILABLE</span><strong>{account ? demo(account.sponsor_available) : "—"}</strong></div></div>
        <div className="form-grid time-grid"><div><label htmlFor="quest-start">Play opens</label><input id="quest-start" type="datetime-local" value={starts} onChange={(event) => setStarts(event.target.value)} required /><small>At least one hour of play time.</small></div><div><label htmlFor="quest-end">Play closes</label><input id="quest-end" type="datetime-local" value={ends} onChange={(event) => setEnds(event.target.value)} required /><small>Claims stay open for 7 days after.</small></div></div>
        <div className="form-note"><Icon name="spark" size={16} /><p>Clutch supports conjunctions only. Move limits in full moves become half-moves in the checklist (40 full moves = 80 half-moves).</p></div>
        <p className="field-help">All dates use {timeZone}. Create, compile and activate before play opens. Joining becomes available when the window opens.</p>
        {formError && <p className="inline-error" role="alert">{formError}</p>}
        <button className="button-primary sponsor-submit" type="submit" disabled={Boolean(busy) || !canWrite || !wallet || !description.trim() || !reward || !starts || !ends}>{busy || "Create unfunded draft"}<Icon name="arrow" size={17} /></button>
      </form><div className="sponsor-policy"><span><span className="mint-dot" /> No tokens accepted</span><span><span className="lavender-dot" /> Reward reserved only after you confirm</span></div>
    </section>
    <section className="panel sponsor-drafts"><div className="panel-heading"><div><span className="eyebrow">YOUR OUTPOST</span><h2>Drafts &amp; posted quests</h2></div><span className="count-note">{drafts.length} drafts</span></div>
      {drafts.length ? <div className="draft-list">{drafts.map((quest) => <article className="draft-card" key={quest.id}><button className="draft-title" type="button" onClick={() => onSelect(quest)}><span><span className="eyebrow">{quest.id}</span><strong>{quest.description}</strong></span><StatePill state={quest.state} quest={quest} /></button><div className="draft-meta"><span>{demo(quest.reward)}</span><span>opens {dateTime(quest.starts_at_ms)}</span><span>closes {dateTime(quest.ends_at_ms)}</span></div>
        {now > quest.starts_at_ms && <p className="inline-error">The scheduled start has passed. Create a new draft with a future start before activating.</p>}
        {quest.state === "DRAFT" ? <button className="button-primary full-width" type="button" disabled={Boolean(busy) || now > quest.starts_at_ms} onClick={() => void onCompile(quest)}>{busy || "Ask validators to compile"}</button> : <><div className="compiled-box"><span className="eyebrow">VALIDATOR CHECKLIST</span>{quest.rules ? <RulesChecklist rules={quest.rules} /> : <p>{quest.reason_codes?.map((code) => REASON_LABELS[code] ?? code).join(" · ")}</p>}{quest.rule_hash && <details className="evidence-drawer"><summary>Review exact rule hash</summary><div className="drawer-content"><code>{quest.rule_hash}</code></div></details>}</div>{quest.compile_status === "COMPILED" && <><label className="confirm-check"><input type="checkbox" checked={Boolean(approved[quest.id])} onChange={(event) => setApproved((current) => ({ ...current, [quest.id]: event.target.checked }))} /><span>I checked these rules, reward and schedule. Reserve {demo(quest.reward)} under this hash.</span></label><button className="button-primary full-width" type="button" disabled={Boolean(busy) || !approved[quest.id] || now > quest.starts_at_ms} onClick={() => void onActivate(quest)}>{busy || "Confirm rules & activate"}</button></>}</>}
      </article>)}</div> : <div className="draft-empty"><div className="empty-icon">♜</div><strong>Your first quest starts here</strong><p>Create a draft above. It won’t reserve a reward until you approve the compiled checklist in a separate transaction.</p></div>}
    </section></div>
  </div>;
}

function ReceiptDetail({ claim, onClose }: { claim: Claim; onClose: () => void }) {
  return <DialogFrame titleId="receipt-title" onClose={onClose}><section className="quest-sheet receipt-sheet"><header className="sheet-top"><span className="eyebrow">PUBLIC PROOF RECEIPT</span><button className="icon-button" type="button" aria-label="Close receipt" onClick={onClose}><Icon name="close" /></button></header><div className="sheet-scroll"><span className={`proof-stamp large ${claim.outcome === "VERIFIED" ? "mint" : claim.outcome === "NOT_QUALIFIED" ? "coral" : "yellow"}`}>{claim.outcome.replaceAll("_", " ")}</span><h2 className="receipt-title" id="receipt-title">{claim.quest_id}</h2><p className="claim-intro">Game <a href={`https://lichess.org/${claim.game_id}`} target="_blank" rel="noreferrer">{claim.game_id} <Icon name="external" size={13} /></a> · submitted {dateTime(claim.submitted_at_ms)}</p><p className="receipt-summary">{claim.outcome === "VERIFIED" ? `${demo(claim.reward_demo_units)} awarded. All conditions matched.` : claim.outcome === "NOT_QUALIFIED" ? `${claim.checks.filter((check) => check.status === "FAIL").length} conditions did not match. No reward was credited.` : "Evidence was incomplete. No reward was credited; inspect the missing checks."}</p><EvidenceChecks checks={claim.checks} /><details className="evidence-drawer" open><summary>Receipt and evidence hashes</summary><div className="drawer-content"><span>Claim ID</span><code>{claim.id}</code><span>Wallet</span><code>{claim.claimant}</code><span>Lichess account</span><code>{claim.lichess_id}</code><span>Evidence SHA-256</span><code>{claim.evidence_hash}</code><span>Settled DEMO</span><code>{demo(claim.reward_demo_units)}</code></div></details><details className="evidence-drawer"><summary>Normalized public source record</summary><pre className="source-record">{JSON.stringify(claim.evidence, null, 2)}</pre></details><p className="source-caveat">Validator agreement confirms the normalized response agreed at claim time. Lichess remains the source of that response.</p></div></section></DialogFrame>;
}

export function ClutchApp() {
  const configured = hasContractAddress();
  const [view, setView] = useState<ViewName>("explore");
  const [network, setNetwork] = useState<NetworkState>(configured ? "checking" : "not-configured");
  const [networkMessage, setNetworkMessage] = useState("");
  const [quests, setQuests] = useState<Quest[]>([]);
  const [account, setAccount] = useState<Account | null>(null);
  const [wallet, setWallet] = useState<string>();
  const [chainId, setChainId] = useState<number>();
  const [connecting, setConnecting] = useState(false);
  const [link, setLink] = useState<LichessLink | null>(null);
  const [challenge, setChallenge] = useState<LinkChallenge | null>(null);
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [claims, setClaims] = useState<Claim[]>([]);
  const [allProofs, setAllProofs] = useState<Claim[]>([]);
  const [proofsLoading, setProofsLoading] = useState(false);
  const [claimsLoading, setClaimsLoading] = useState(false);
  const [detailsError, setDetailsError] = useState("");
  const detailRequest = useRef(0);
  const transactionLock = useRef(false);
  const [selected, setSelected] = useState<Quest | null>(null);
  const [selectedClaim, setSelectedClaim] = useState<Claim | null>(null);
  const [speed, setSpeed] = useState("ALL");
  const [layout, setLayout] = useState<"map" | "list">("map");
  const [busy, setBusy] = useState("");
  const [toast, setToast] = useState<Toast | null>(null);
  const [lastReceipt, setLastReceipt] = useState<ReceiptProgress | null>(null);

  const currentQuest = selected && !selected.id.startsWith("sample-")
    ? quests.find((item) => item.id === selected.id) ?? selected
    : selected;
  const previewQuest = Boolean(currentQuest?.id.startsWith("sample-"));
  const allVisibleQuests = useMemo(() => {
    const visibleLive = quests.filter((quest) => !["DRAFT", "COMPILED"].includes(quest.state) || quest.sponsor?.toLowerCase() === wallet?.toLowerCase());
    return visibleLive.length ? visibleLive : PREVIEW_QUESTS;
  }, [quests, wallet]);

  const reload = useCallback(async () => {
    if (!configured) {
      setNetwork("not-configured"); setNetworkMessage(""); setQuests([]); setAccount(null);
      return [] as Quest[];
    }
    setNetwork("checking");
    try {
      const [chain, info, items] = await Promise.all([
        checkRpcChain(),
        readContract<{ chain_id: number; contract: string; runner: string; version: string }>("get_contract_info"),
        readContract<Quest[]>("list_quests", [0, 50]),
      ]);
      if (chain !== CHAIN_ID || info.chain_id !== CHAIN_ID) throw new Error(`Connected RPC or contract reports a chain other than ${CHAIN_ID}.`);
      if (info.contract?.toLowerCase() !== CONTRACT_ADDRESS.toLowerCase()) throw new Error("The configured address does not match the contract’s own address.");
      if (!info.runner?.includes("py-genlayer:")) throw new Error("The contract did not report a pinned GenVM runner.");
      const list = Array.isArray(items) ? items : [];
      setQuests(list); setNetwork("ready"); setNetworkMessage(`${info.version} · chain ${chain}`);
      if (wallet) {
        const user = await readContract<Account>("get_account", [wallet]);
        setAccount(user);
      }
      setSelected((previous) => {
        if (previous && !previous.id.startsWith("sample-") && list.some((item) => item.id === previous.id)) return list.find((item) => item.id === previous.id) ?? previous;
        return previous;
      });
      return list;
    } catch (error) {
      setNetwork("error"); setNetworkMessage(error instanceof Error ? error.message : String(error));
      setQuests([]); setAccount(null); setLink(null); setChallenge(null); setEnrollment(null); setClaims([]);
      return [] as Quest[];
    }
  }, [configured, wallet]);

  const loadMyData = useCallback(async (address?: string) => {
    if (!configured || !address || network !== "ready") return;
    try {
      const [user, linked] = await Promise.all([
        readContract<Account>("get_account", [address]),
        readContract<LichessLink>("get_link_for_wallet", [address]),
      ]);
      setAccount(user); setLink(linked?.lichess_id ? linked : null);
      try { setChallenge(await readContract<LinkChallenge>("get_active_link_challenge", [address])); }
      catch { setChallenge(null); }
    } catch { setAccount(null); setLink(null); setChallenge(null); }
  }, [configured, network]);

  const loadQuestDetails = useCallback(async (questId?: string) => {
    const request = ++detailRequest.current;
    if (!configured || network !== "ready" || !questId || questId.startsWith("sample-")) return;
    await Promise.resolve();
    setClaimsLoading(true); setDetailsError("");
    try {
      const [joined, receipts] = await Promise.all([
        wallet ? readContract<Enrollment>("get_enrollment", [questId, wallet]) : Promise.resolve(null),
        readContract<Claim[]>("list_claims", [questId, 0, 50]),
      ]);
      if (request !== detailRequest.current) return;
      setEnrollment(joined?.enrolled ? joined : null);
      const claimList = Array.isArray(receipts) ? receipts : [];
      setClaims(claimList);
    } catch { if (request === detailRequest.current) setDetailsError("Couldn’t read enrollment and receipts. Retry before taking a quest action."); }
    finally { if (request === detailRequest.current) setClaimsLoading(false); }
  }, [configured, network, wallet]);

  useEffect(() => {
    if (!configured) return;
    const timer = window.setTimeout(() => { void reload(); }, 0);
    return () => window.clearTimeout(timer);
  }, [configured, reload]);

  useEffect(() => {
    if (!window.ethereum) return;
    const provider = window.ethereum;
    const accountsChanged = (value: unknown) => {
      const accounts = value as string[];
      const nextWallet = accounts?.[0];
      setWallet(nextWallet);
      setAccount(null); setLink(null); setChallenge(null); setEnrollment(null); setClaims([]);
    };
    const chainChanged = (value: unknown) => setChainId(Number.parseInt(String(value), 16));
    void provider.request({ method: "eth_accounts" }).then(accountsChanged).catch(() => undefined);
    void provider.request({ method: "eth_chainId" }).then(chainChanged).catch(() => undefined);
    provider.on?.("accountsChanged", accountsChanged); provider.on?.("chainChanged", chainChanged);
    return () => { provider.removeListener?.("accountsChanged", accountsChanged); provider.removeListener?.("chainChanged", chainChanged); };
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadMyData(wallet); }, 0);
    return () => window.clearTimeout(timer);
  }, [wallet, network, loadMyData]);
  useEffect(() => {
    const timer = window.setTimeout(() => { void loadQuestDetails(currentQuest?.id); }, 0);
    return () => window.clearTimeout(timer);
  }, [currentQuest?.id, network, wallet, loadQuestDetails]);

  useEffect(() => {
    const navigate = (event: Event) => {
      const detail = (event as CustomEvent<ViewName>).detail;
      if (["explore", "sponsor", "proofs"].includes(detail)) setView(detail);
    };
    document.addEventListener("clutch:navigate", navigate);
    return () => document.removeEventListener("clutch:navigate", navigate);
  }, []);

  useEffect(() => {
    if (view !== "proofs" || network !== "ready") return;
    let alive = true;
    void Promise.resolve().then(() => {
      if (!alive) return [] as Claim[][];
      setProofsLoading(true);
      return Promise.all(quests.map((quest) => readContract<Claim[]>("list_claims", [quest.id, 0, 50]).catch(() => [])));
    }).then((pages) => { if (alive) setAllProofs(pages.flat().sort((a, b) => (b.submitted_at_ms ?? 0) - (a.submitted_at_ms ?? 0))); })
      .finally(() => { if (alive) setProofsLoading(false); });
    return () => { alive = false; };
  }, [view, network, quests]);

  async function connectWallet() {
    if (!window.ethereum) { setToast({ kind: "error", message: "No browser wallet found. Install an EIP-1193 wallet to sign quest actions." }); return; }
    setConnecting(true);
    try {
      const accounts = await window.ethereum.request({ method: "eth_requestAccounts" }) as string[];
      if (!accounts?.[0]) throw new Error("The wallet did not return an account.");
      setWallet(accounts[0]);
      const currentChain = await window.ethereum.request({ method: "eth_chainId" });
      setChainId(Number.parseInt(String(currentChain), 16));
    } catch (error) { setToast({ kind: "error", message: error instanceof Error ? error.message : String(error) }); }
    finally { setConnecting(false); }
  }

  function selectQuest(quest: Quest) {
    detailRequest.current++;
    setSelected(quest);
    setEnrollment(null);
    setClaims([]);
    setDetailsError(""); setClaimsLoading(!quest.id.startsWith("sample-"));
    setToast(null); setLastReceipt(null);
  }

  async function switchNetwork() {
    if (!window.ethereum) return;
    try {
      await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: CHAIN_ID_HEX }] });
    } catch (error) {
      if ((error as { code?: number })?.code !== 4902) { setToast({ kind: "error", message: error instanceof Error ? error.message : String(error) }); return; }
      try { await window.ethereum.request({ method: "wallet_addEthereumChain", params: [{ chainId: CHAIN_ID_HEX, chainName: "GenLayer Studio Net", rpcUrls: [RPC_URL], nativeCurrency: { name: "GEN", symbol: "GEN", decimals: 18 }, blockExplorerUrls: [EXPLORER_URL] }] }); }
      catch (addError) { setToast({ kind: "error", message: addError instanceof Error ? addError.message : String(addError) }); return; }
    }
    const currentChain = await window.ethereum.request({ method: "eth_chainId" });
    setChainId(Number.parseInt(String(currentChain), 16));
  }

  async function transact(method: string, args: unknown[], label: string): Promise<ReceiptProgress | null> {
    if (transactionLock.current) return null;
    if (!configured) { setToast({ kind: "error", message: "Set NEXT_PUBLIC_CONTRACT_ADDRESS to a deployed Clutch contract first." }); return null; }
    if (!window.ethereum || !wallet) { setToast({ kind: "error", message: "Connect a wallet before signing this action." }); return null; }
    if (chainId !== CHAIN_ID) { setToast({ kind: "error", message: `Switch your wallet to Studio Net (${CHAIN_ID}) first.` }); return null; }
    transactionLock.current = true;
    setBusy(label); setToast({ kind: "info", message: `${label} · approve in your wallet` }); setLastReceipt(null);
    try {
      const progress = await writeContract(window.ethereum, wallet, method, args, (hash) => { setLastReceipt({ hash, status: "PENDING", execution: "WAITING", consensus: "WAITING" }); setToast({ kind: "info", message: `${label} · submitted; waiting for validator consensus and finality` }); });
      setLastReceipt(progress); setToast({ kind: "success", message: `${label} · finalized, execution returned, majority agreed` });
      await reload();
      return progress;
    } catch (error) {
      setToast({ kind: "error", message: error instanceof Error ? error.message : String(error) });
      return null;
    } finally { transactionLock.current = false; setBusy(""); }
  }

  async function claimStarter() {
    if (!account?.starter_claimed) {
      const result = await transact("claim_starter_allocation", [], "Claim starter units");
      if (result) await loadMyData(wallet);
    }
  }

  async function createDraft(data: { description: string; reward: number; starts: number; ends: number }) {
    const progress = await transact("create_draft", [data.description, data.reward, data.starts, data.ends], "Create draft");
    if (!progress) return;
    const list = await reload();
    const created = list.find((quest) => quest.sponsor?.toLowerCase() === wallet?.toLowerCase() && quest.description === data.description && quest.state === "DRAFT");
    if (created) { setView("sponsor"); setToast({ kind: "success", message: `Draft ${created.id} created. Compile it below, review the exact rules, then activate before play opens.` }); }
  }

  async function compileDraft(quest: Quest) {
    const result = await transact("compile_draft", [quest.id], "Compile quest rules");
    if (result) {
      const updated = await readContract<Quest>("get_quest", [quest.id]).catch(() => null);
      if (updated) setSelected(updated);
    }
  }

  async function activateQuest(quest: Quest) {
    const result = await transact("confirm_and_activate", [quest.id, quest.rule_hash], "Confirm and activate");
    if (result) {
      const updated = await readContract<Quest>("get_quest", [quest.id]).catch(() => null);
      if (updated) setSelected(updated);
      setView("explore");
    }
  }

  async function requestLink(lichessId: string) {
    const result = await transact("request_link_challenge", [lichessId], "Request Lichess challenge");
    if (result && wallet) {
      const current = await readContract<LinkChallenge>("get_active_link_challenge", [wallet]).catch(() => null);
      setChallenge(current);
    }
  }

  async function verifyLink() {
    if (!challenge) return;
    const result = await transact("verify_link_challenge", [challenge.nonce], "Verify Lichess profile");
    if (result) { setChallenge(null); await loadMyData(wallet); }
  }

  async function joinQuest() {
    if (!currentQuest) return;
    const result = await transact("join_quest", [currentQuest.id], "Join quest");
    if (result) await loadQuestDetails(currentQuest.id);
  }

  async function submitGame(gameId: string) {
    if (!currentQuest) return;
    const result = await transact("submit_game", [currentQuest.id, parseGameId(gameId)], "Verify game evidence");
    if (result) {
      await loadQuestDetails(currentQuest.id);
      const receipts = await readContract<Claim[]>("list_claims", [currentQuest.id, 0, 50]).catch(() => null);
      const claim = receipts?.filter((item) => item.game_id === gameId && item.claimant.toLowerCase() === wallet?.toLowerCase()).sort((a, b) => b.submitted_at_ms - a.submitted_at_ms)[0];
      if (claim) setToast({ kind: claim.outcome === "VERIFIED" ? "success" : claim.outcome === "NOT_QUALIFIED" ? "error" : "info", message: claim.outcome === "VERIFIED" ? `Quest cleared! ${demo(claim.reward_demo_units)} awarded.` : claim.outcome === "NOT_QUALIFIED" ? "Game verified, but quest conditions did not match. No reward awarded; inspect the failed checks below." : "The receipt needs more evidence. No reward awarded; inspect the missing checks below." });
    }
  }

  async function expireQuest() {
    if (!currentQuest) return;
    const result = await transact("expire_quest", [currentQuest.id], "Refund expired quest");
    if (result) { const updated = await readContract<Quest>("get_quest", [currentQuest.id]).catch(() => null); if (updated) setSelected(updated); }
  }

  async function reloadProofs() {
    if (network !== "ready") return;
    setProofsLoading(true);
    try {
      const pages = await Promise.all(quests.map((quest) => readContract<Claim[]>("list_claims", [quest.id, 0, 50]).catch(() => [])));
      setAllProofs(pages.flat().sort((a, b) => (b.submitted_at_ms ?? 0) - (a.submitted_at_ms ?? 0)));
    } finally { setProofsLoading(false); }
  }

  const companionMessage = network === "not-configured"
    ? "Hey, captain! The map is here, but this outpost still needs its contract address before we can take real turns."
    : network === "checking" ? "I’m checking the board markers with Studio Net. Give me a sec to find the live quests."
      : network === "error" ? "I can’t read that board yet. The contract or Studio Net RPC needs a quick check."
        : !wallet ? "The quest board is public. Connect a wallet only when you’re ready to sponsor, link, or claim."
          : chainId !== CHAIN_ID ? "Tiny detour! Switch your wallet to Studio Net before we make an on-chain move."
            : !link?.lichess_id ? "Next move: link your Lichess account. I’ll hold the profile challenge while you add it to your bio."
              : currentQuest?.state === "ACTIVE" && !enrollment?.enrolled ? `@${link.lichess_id} is linked. Join the quest before the game starts and you’re set.`
                : "Nice and tidy. Rules first, then a fresh game, then the public receipt.";

  const personalClaims = wallet ? claims.filter((claim) => claim.claimant.toLowerCase() === wallet.toLowerCase()) : claims;
  const hasLiveBoard = network === "ready";

  return <main className="app-shell">
    <header className="topbar"><div className="topbar-left"><Brand /><span className="brand-tagline">Turn a challenge into a quest.</span></div><nav className="top-nav" aria-label="Main navigation"><button type="button" className={view === "explore" ? "active" : ""} aria-current={view === "explore" ? "page" : undefined} onClick={() => setView("explore")}>Quest map</button><button type="button" className={view === "sponsor" ? "active" : ""} aria-current={view === "sponsor" ? "page" : undefined} onClick={() => setView("sponsor")}>Sponsor a quest</button><button type="button" className={view === "proofs" ? "active" : ""} aria-current={view === "proofs" ? "page" : undefined} onClick={() => { setView("proofs"); void reloadProofs(); }}>Proof shelf</button></nav><div className="wallet-cluster"><div className="demo-balance"><span className="unit-gem">◆</span><span><small>YOUR DEMO</small><strong>{account ? demo(account.sponsor_available) : "—"}</strong></span></div><span className={`network-pill ${network}`}><span className="network-dot" />{network === "ready" ? "Studio Net" : network === "checking" ? "Checking…" : network === "error" ? "Board offline" : "No contract"}</span>{wallet ? <button type="button" className={`wallet-button ${chainId !== CHAIN_ID ? "wrong-chain" : ""}`} onClick={chainId !== CHAIN_ID ? () => void switchNetwork() : () => void loadMyData(wallet)} title={chainId !== CHAIN_ID ? "Switch to Studio Net" : `Wallet ${wallet}`}>{compactAddress(wallet)}<span className="wallet-dot" /></button> : <button type="button" className="wallet-button connect-button" disabled={connecting} onClick={() => void connectWallet()}><Icon name="wallet" size={15} />{connecting ? "Connecting…" : "Connect"}</button>}</div></header>

    {toast && <div className={`toast-banner ${toast.kind}`} role={toast.kind === "error" ? "alert" : "status"}><span className="toast-symbol">{toast.kind === "success" ? <Icon name="check" size={16} /> : toast.kind === "error" ? "!" : <span className="spinner small" />}</span><span>{toast.message}</span>{lastReceipt && <a href={`${EXPLORER_URL}/tx/${lastReceipt.hash}`} target="_blank" rel="noreferrer">{lastReceipt.status} · {lastReceipt.execution} · {lastReceipt.consensus} <Icon name="external" size={13} /></a>}<button type="button" className="toast-close" aria-label="Dismiss message" onClick={() => setToast(null)}><Icon name="close" size={15} /></button></div>}

    {network === "error" && <div className="connection-alert" role="status"><span>!</span><div><strong>Couldn’t read this contract</strong><p>{networkMessage}</p></div><button type="button" onClick={() => void reload()}><Icon name="refresh" size={15} /> Retry</button></div>}
    {network === "not-configured" && <div className="preview-banner"><span className="preview-banner-mark">i</span><div><strong>Preview board</strong><span>Example quests are for browsing only. Connect a deployed contract with <code>NEXT_PUBLIC_CONTRACT_ADDRESS</code> to enable on-chain actions and public receipts.</span></div><span className="preview-banner-tag">NO LIVE REWARDS</span></div>}

    <div className="hero-strip"><div className="hero-copy"><span className="eyebrow">GENLAYER · CHESS QUESTS</span><h1>Make your next game <span>count.</span></h1><p>Agree on the rules before the game. Verify the result afterward.</p></div><div className="hero-right"><div className="hero-stat"><span className="hero-stat-icon">✦</span><span><small>RULE SET</small><strong>Small &amp; explicit</strong></span></div><div className="hero-stat"><span className="hero-stat-icon mint">♧</span><span><small>REWARD</small><strong>DEMO · no cash value</strong></span></div>{hasLiveBoard && !account?.starter_claimed && wallet && chainId === CHAIN_ID && <button className="starter-button" type="button" disabled={Boolean(busy)} onClick={() => void claimStarter()}>{busy || "Claim 100 starter DEMO"}</button>}</div></div>

    <nav className="mobile-nav" aria-label="Main navigation"><button type="button" className={view === "explore" ? "active" : ""} aria-current={view === "explore" ? "page" : undefined} onClick={() => setView("explore")}><Icon name="map" size={18} />Map</button><button type="button" className={view === "sponsor" ? "active" : ""} aria-current={view === "sponsor" ? "page" : undefined} onClick={() => setView("sponsor")}><Icon name="plus" size={18} />Sponsor</button><button type="button" className={view === "proofs" ? "active" : ""} aria-current={view === "proofs" ? "page" : undefined} onClick={() => { setView("proofs"); void reloadProofs(); }}><Icon name="chess" size={18} />Proofs</button></nav>

    {view === "explore" && <div className="main-grid"><div className="primary-column"><section className="panel quick-start"><div><h2>Scout the rules before you play</h2><p>Replay a saved game with no wallet, or set up an easy draw quest for a live award.</p></div><div className="game-actions"><button type="button" className="button-secondary" onClick={() => selectQuest(PREVIEW_QUESTS[0])}>Try a saved game</button><button type="button" className="button-primary" onClick={() => setView("sponsor")}>Set up the demo</button></div></section><QuestMap quests={allVisibleQuests} selectedSpeed={speed} onChooseSpeed={setSpeed} onSelect={selectQuest} layout={layout} onLayout={setLayout} liveReady={hasLiveBoard} />
      <section className="camp-section"><div className="section-head"><div><h2>Public quests</h2></div><button type="button" className="small-action" onClick={() => setView("sponsor")}><Icon name="plus" size={16} /> New expedition</button></div><div className="camp-grid">{(quests.filter((quest) => ["ACTIVE", "AWARDED", "EXPIRED_REFUNDED"].includes(quest.state)).slice(0, 2)).map((quest) => <QuestTile key={quest.id} quest={quest} compact onSelect={selectQuest} />)}{!hasLiveBoard && PREVIEW_QUESTS.slice(0, 2).map((quest) => <QuestTile key={quest.id} quest={quest} compact onSelect={selectQuest} />)}<button type="button" className="new-expedition-card" onClick={() => setView("sponsor")}><span className="new-plus"><Icon name="plus" size={27} /></span><strong>Post a quest</strong><span>Set conditions and a DEMO reward</span></button></div></section>
    </div><aside className="right-rail"><CompanionCard message={companionMessage} status={network} /><section className="panel account-panel"><div className="account-panel-heading"><div><span className="eyebrow">PLAYER STATUS</span><h2>Your camp</h2></div><span className={`account-presence ${wallet ? "present" : ""}`} title={wallet ? "Wallet connected" : "Wallet not connected"} /></div><div className="account-lines"><div><span>Wallet</span><strong>{wallet ? compactAddress(wallet) : "Not connected"}</strong></div><div><span>Lichess link</span><strong>{link?.lichess_id ? `@${link.lichess_id}` : "Not linked"}</strong></div><div><span>Available DEMO</span><strong>{account ? demo(account.sponsor_available) : "—"}</strong></div><div><span>Awarded DEMO</span><strong className="reward-text">{account ? demo(account.awarded) : "—"}</strong></div></div>{wallet && chainId === CHAIN_ID && hasLiveBoard && !account?.starter_claimed && <button className="text-button claim-starter" type="button" onClick={() => void claimStarter()}>Claim your one-time starter allocation <Icon name="arrow" size={14} /></button>}<p className="account-disclaimer">Demo accounting only. Units have no cash value and can’t be withdrawn.</p></section><ActivityPanel claims={personalClaims} loading={claimsLoading} onSelectClaim={setSelectedClaim} liveReady={hasLiveBoard} /><div className="side-footnote"><span>♙</span><p>No tokens move through Clutch. Your wallet signs demo-state changes on Studio Net.</p></div></aside></div>}

    {view === "sponsor" && <SponsorDesk wallet={wallet} account={account} quests={quests} busy={busy} canWrite={hasLiveBoard && Boolean(wallet) && chainId === CHAIN_ID} blockMessage={!wallet ? "Connect a wallet on Studio Net to create a funded quest." : chainId !== CHAIN_ID ? `Switch to Studio Net (${CHAIN_ID}) in the wallet first.` : network === "not-configured" ? "Add a deployed Clutch contract address to enable sponsor actions." : networkMessage || "The configured contract is not available."} onCreate={createDraft} onCompile={compileDraft} onActivate={activateQuest} onSelect={selectQuest} onConnect={() => void connectWallet()} />}
    {view === "proofs" && <section className="panel proofs-panel" id="proofs"><div className="panel-heading proof-heading"><div><span className="eyebrow">PUBLIC RECEIPTS · NO WALLET NEEDED</span><h1>Proof shelf</h1><p className="heading-note">Every row comes from <code>list_claims</code> on the configured contract.</p></div><button type="button" className="view-toggle refresh-proof" disabled={proofsLoading || network !== "ready"} onClick={() => void reloadProofs()}><Icon name="refresh" size={15} /> Refresh</button></div>{network === "not-configured" ? <div className="proof-empty"><div className="proof-empty-icon">♙</div><h3>Connect the public board</h3><p>Set a deployed contract address to browse receipts. Clutch does not make sample proofs.</p></div> : network === "error" ? <div className="proof-empty"><div className="proof-empty-icon">!</div><h3>Public board unavailable</h3><p>{networkMessage}</p></div> : <ProofShelf claims={allProofs} loading={proofsLoading || network === "checking"} onSelect={setSelectedClaim} />}</section>}

    <footer className="app-footer"><span><Brand /> <span className="footer-copy">Agree on rules first. Verify the result afterward.</span></span><span>CLUTCH · DEMO ACCOUNTING · <a href="https://docs.genlayer.com/developers/networks" target="_blank" rel="noreferrer">STUDIO NET</a></span></footer>

    {currentQuest && <QuestDetail key={currentQuest.id} quest={currentQuest} preview={previewQuest} liveReady={hasLiveBoard} wallet={wallet} chainId={chainId} link={link} challenge={challenge} enrollment={enrollment} claims={claims} busy={busy} detailsLoading={claimsLoading} detailsError={detailsError} onRetryDetails={() => void loadQuestDetails(currentQuest.id)} toast={toast} receipt={lastReceipt} onClose={() => { setSelected(null); detailRequest.current++; }} onConnect={() => void connectWallet()} onSwitchNetwork={() => void switchNetwork()} onRequestLink={requestLink} onVerifyLink={verifyLink} onJoin={joinQuest} onSubmit={submitGame} onExpire={expireQuest} onSelectClaim={(claim) => setSelectedClaim(claim)} />}
    {selectedClaim && <ReceiptDetail claim={selectedClaim} onClose={() => setSelectedClaim(null)} />}
  </main>;
}
