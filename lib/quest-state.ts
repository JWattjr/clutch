import type { Quest } from "./contract";

export function questPhase(quest: Quest, now: number): string {
  if (quest.state !== "ACTIVE") return quest.state;
  if (!now) return "CHECKING_TIME";
  if (now < quest.starts_at_ms) return "UPCOMING";
  if (now <= quest.ends_at_ms) return "OPEN";
  if (now <= quest.claim_deadline_ms) return "CLAIMS_ONLY";
  return "DEADLINE_PASSED";
}

export function remainingTime(until: number, now: number): string {
  const minutes = Math.max(1, Math.ceil((until - now) / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h${minutes % 60 ? ` ${minutes % 60}m` : ""}`;
}

export const EASY_DESCRIPTION = "Draw a casual standard Lichess game with either color and any time control. No move limit.";
export function demoSchedule(hours = 48): { starts: number; ends: number } {
  // Allow time to create, compile and confirm before the contract's start boundary.
  const starts = Math.ceil((Date.now() + 30 * 60_000) / 60_000) * 60_000;
  return { starts, ends: starts + hours * 3_600_000 };
}

export function localDateInput(timestamp: number): string {
  const date = new Date(timestamp);
  return new Date(timestamp - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

export function scheduleError(starts: number, ends: number, now: number): string {
  if (!Number.isFinite(starts) || !Number.isFinite(ends)) return "Choose both play dates.";
  if (starts <= now) return "Choose a future start so validators can compile and you can activate before play opens.";
  if (starts > now + 30 * 86_400_000) return "Play must open within the next 30 days.";
  if (ends < starts + 3_600_000) return "Allow at least one hour between opening and closing.";
  if (ends > starts + 30 * 86_400_000) return "The play window can be at most 30 days long.";
  return "";
}
