"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import { BOT_DEMO_CONTRACT_ADDRESS, CHAIN_ID, EXPLORER_URL, RUNNER, readContractAt, type Claim, type Quest } from "@/lib/contract";

type Board = { quests: Quest[]; claims: Claim[] };
const STEPS = ["Freeze a casual draw quest", "Link & enroll the BOT", "Play through the Bot API", "Verify & award DEMO"];

export function BotDemoPanel({ onSelectClaim }: { onSelectClaim: (claim: Claim) => void }) {
  const [board, setBoard] = useState<Board>({ quests: [], claims: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const request = useRef(0);
  const configured = /^0x[\da-fA-F]{40}$/.test(BOT_DEMO_CONTRACT_ADDRESS);
  const refresh = useCallback(async () => {
    const id = ++request.current; setLoading(true); setError("");
    try {
      if (!configured) throw new Error("The automated demo contract has not been connected yet.");
      const info = await readContractAt<{ version: string; chain_id: number; contract: string; runner: string; participant_modes: string[] }>(BOT_DEMO_CONTRACT_ADDRESS, "get_contract_info");
      if (info.version !== "clutch/0.2.0" || info.chain_id !== CHAIN_ID || info.contract.toLowerCase() !== BOT_DEMO_CONTRACT_ADDRESS.toLowerCase() || !info.runner.includes(RUNNER) || !info.participant_modes.includes("BOT_DEMO")) throw new Error("The demo address does not report the expected BOT policy.");
      const count = await readContractAt<number>(BOT_DEMO_CONTRACT_ADDRESS, "get_quest_count");
      const quests = (await readContractAt<Quest[]>(BOT_DEMO_CONTRACT_ADDRESS, "list_quests", [Math.max(0, count - 50), 50])).filter(q => q.participant_policy === "BOT_DEMO").reverse();
      const claims: Claim[] = [];
      // Bound requests and pace them for the shared Studio RPC.
      for (const quest of quests.slice(0, 10)) claims.push(...await readContractAt<Claim[]>(BOT_DEMO_CONTRACT_ADDRESS, "list_claims", [quest.id, 0, 50]));
      if (request.current === id) setBoard({ quests, claims });
    } catch (failure) {
      if (request.current === id) setError(failure instanceof Error ? failure.message : "Couldn’t read the automated demo.");
    } finally { if (request.current === id) setLoading(false); }
  }, [configured]);
  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0);
    const counter = request;
    return () => { window.clearTimeout(timer); counter.current++; };
  }, [refresh]);
  const latest = board.quests[0];
  const awarded = board.claims.find(c => c.outcome === "VERIFIED" && c.participant_policy === "BOT_DEMO");
  const status = awarded ? "Award recorded" : latest?.state === "ACTIVE" ? "Quest activated" : latest?.state === "COMPILED" ? "Rules frozen · account setup pending" : latest ? "Draft created" : "No automated run recorded yet";

  return <section className="panel bot-demo-panel" aria-labelledby="bot-demo-title">
    <div className="bot-demo-heading"><div><h1 id="bot-demo-title">Let the knights do the legwork.</h1><p className="bot-demo-label">Casual BOT demo · no wallet needed to view</p><p>Two controlled BOT accounts play a scripted casual game. GenLayer checks the public result against the frozen quest and records the DEMO award.</p></div><Image className="bot-demo-companion" src="/images/clutch-knight.png" alt="" width={110} height={110} /></div>
    <div className="bot-demo-status" role="status"><span className={`state-pill ${awarded ? "mint" : "lavender"}`}>{loading ? "Reading live demo…" : error ? "Demo unavailable" : status}</span><button type="button" className="button-secondary" disabled={loading} onClick={() => void refresh()}>{loading ? "Refreshing…" : "Refresh live status"}</button></div>
    {error ? <div className="connection-alert" role="alert"><p>{error}</p></div> : <>
      <ol className="bot-demo-steps">{STEPS.map((step, index) => <li key={step}><span aria-hidden="true">0{index + 1}</span>{step}</li>)}</ol>
      {!loading && !awarded && <div className="bot-demo-notice"><strong>{latest?.state === "ACTIVE" ? "The live quest is waiting for a qualifying game." : "The automated award is still pending."}</strong><p>{latest?.state === "COMPILED" ? "The casual draw rules are ready. BOT account setup comes next; play opens immediately when the operator activates the quest." : "A finished game and a verified claim will appear here once the operator completes the run."} You can inspect this page without playing chess.</p></div>}
      {board.quests.slice(0, 10).map(quest => <article className="bot-demo-quest" key={quest.id}>
        <div className="bot-demo-quest-heading"><div><span className="eyebrow">{quest.id} · AUTOMATED BOT DEMO</span><h2>{quest.description}</h2></div><span className={`state-pill ${quest.state === "AWARDED" ? "mint" : "lavender"}`}>{quest.state.replaceAll("_", " ")}</span></div>
        <dl className="bot-demo-facts"><div><dt>Participants</dt><dd>Two BOT accounts · casual only</dd></div><div><dt>Outcome</dt><dd>{quest.rules?.result === "DRAW" ? "Draw" : quest.rules?.result ?? "Awaiting compilation"}</dd></div><div><dt>Reward</dt><dd>{quest.reward} DEMO · no cash value</dd></div><div><dt>Play window</dt><dd>{quest.activated_at_ms ? `${new Date(quest.starts_at_ms).toLocaleString()} – ${new Date(quest.ends_at_ms).toLocaleString()}` : "1 hour, opening on activation"}</dd></div></dl>
        {quest.rule_hash && <details className="evidence-drawer"><summary>Inspect the frozen rules & hash</summary><pre className="source-record">{JSON.stringify({ participant_policy: quest.participant_policy, window_mode: quest.window_mode, window_duration_ms: quest.window_duration_ms, rules: quest.rules, rule_hash: quest.rule_hash, activation_hash: quest.activation_hash }, null, 2)}</pre></details>}
        <div className="bot-demo-receipts">{board.claims.filter(c => c.quest_id === quest.id).map(claim => <button type="button" key={claim.id} className="button-secondary" onClick={() => onSelectClaim(claim)}>Inspect {claim.outcome.replaceAll("_", " ").toLowerCase()} receipt · {claim.game_id}</button>)}</div>
      </article>)}
    </>}
    <p className="bot-demo-caveat">This scripted game demonstrates the verification and accounting flow. It does not demonstrate competitive chess ability. Human quests use their own board and exclude BOT games.</p>
    {configured && <a className="bot-demo-contract" href={`${EXPLORER_URL}/address/${BOT_DEMO_CONTRACT_ADDRESS}`} target="_blank" rel="noreferrer">Inspect demo contract on Studio Net ↗</a>}
  </section>;
}
