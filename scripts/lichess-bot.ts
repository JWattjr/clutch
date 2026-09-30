/** Local operator only: these tokens must never enter the browser bundle. */
const ORIGIN = "https://lichess.org";
export type BotAccount = { id: string; username: string; title?: string; count?: { all?: number } };
export type BotGame = {
  id: string; rated: boolean; variant: { key: string };
  white: { id: string; title?: string }; black: { id: string; title?: string };
  state: { moves: string; status: string; winner?: string };
};

async function response(path: string, token: string, form?: Record<string, string>): Promise<Response> {
  const result = await fetch(`${ORIGIN}${path}`, {
    method: form ? "POST" : "GET",
    headers: { Authorization: `Bearer ${token}`, ...(form ? { "Content-Type": "application/x-www-form-urlencoded" } : {}) },
    body: form ? new URLSearchParams(form) : undefined,
    signal: AbortSignal.timeout(20_000),
  });
  if (!result.ok) {
    // Do not echo response bodies: authentication errors must not leak credentials.
    throw new Error(`Lichess ${path}: HTTP ${result.status}${result.status === 429 ? "; wait at least one minute before retrying" : ""}.`);
  }
  return result;
}

export async function botAccount(token: string): Promise<BotAccount> {
  const account = await (await response("/api/account", token)).json() as BotAccount;
  if (!account.id || account.title !== "BOT") throw new Error("Both tokens must belong to already upgraded BOT accounts. Regular accounts are never upgraded by this runner.");
  return account;
}

export async function upgradeEmptyDemoAccounts(accounts: Array<{ token: string; expectedId: string }>): Promise<void> {
  const checked: BotAccount[] = [];
  for (const item of accounts) {
    const account = await (await response("/api/account", item.token)).json() as BotAccount;
    if (!item.expectedId || account.id !== item.expectedId.toLowerCase() || account.id === "wattxbt") throw new Error("Upgrade requires the exact IDs of the two dedicated demo accounts. Wattxbt is excluded.");
    if (account.title !== "BOT" && account.count?.all !== 0) throw new Error("A demo account must have zero played games before its irreversible BOT upgrade.");
    checked.push(account);
  }
  if (checked[0].id === checked[1].id) throw new Error("Two distinct demo accounts are required.");
  for (let i = 0; i < checked.length; i++) {
    if (checked[i].title !== "BOT") await response("/api/bot/account/upgrade", accounts[i].token, {});
    const upgraded = await botAccount(accounts[i].token);
    console.log(`BOT account ready: ${upgraded.username}`);
  }
}

export async function challenge(token: string, opponent: string): Promise<string> {
  const body = await (await response(`/api/challenge/${encodeURIComponent(opponent)}`, token, {
    rated: "false", "clock.limit": "300", "clock.increment": "3", color: "white", variant: "standard",
  })).json() as { challenge?: { id?: string }; id?: string };
  const id = body.challenge?.id ?? body.id;
  if (!id || !/^[a-zA-Z0-9]{8}$/.test(id)) throw new Error("Lichess did not return a public challenge ID.");
  return id;
}

export async function acceptChallenge(token: string, id: string): Promise<void> {
  await response(`/api/challenge/${id}/accept`, token, {});
}

export async function gameState(token: string, id: string): Promise<BotGame> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    const result = await fetch(`${ORIGIN}/api/bot/game/stream/${id}`, {
      headers: { Authorization: `Bearer ${token}` }, signal: controller.signal,
    });
    if (!result.ok || !result.body) throw new Error(`Lichess game stream: HTTP ${result.status}.`);
    const reader = result.body.getReader();
    const decoder = new TextDecoder(); let buffered = "";
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) throw new Error("Lichess closed the stream before returning gameFull.");
        buffered += decoder.decode(chunk.value, { stream: true });
        let end: number;
        while ((end = buffered.indexOf("\n")) >= 0) {
          const line = buffered.slice(0, end).trim(); buffered = buffered.slice(end + 1);
          if (!line) continue;
          const value = JSON.parse(line) as BotGame & { type: string };
          if (value.type === "gameFull") return value;
        }
      }
    } finally { await reader.cancel(); }
  } finally { clearTimeout(timeout); controller.abort(); }
}

export async function move(token: string, id: string, uci: string): Promise<void> {
  await response(`/api/bot/game/${id}/move/${uci}`, token, {});
}

export async function draw(token: string, id: string): Promise<void> {
  await response(`/api/bot/game/${id}/draw/yes`, token, {});
}

export async function publicGame(id: string): Promise<Record<string, unknown>> {
  const result = await fetch(`${ORIGIN}/game/export/${id}?moves=true&tags=true&clocks=false&evals=false&opening=false`, {
    headers: { Accept: "application/json" }, signal: AbortSignal.timeout(20_000),
  });
  if (!result.ok) throw new Error(`Public Lichess export: HTTP ${result.status}.`);
  return result.json() as Promise<Record<string, unknown>>;
}
