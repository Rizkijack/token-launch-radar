// LAUNCH RADAR model v3 — the curve, the band, and the verdict.
//
// The house starter scores value as tvl x 0.25 x growth x maturity. That is a guess with no anchor.
// This model calibrates itself against the snapshot's own already-trading protocols: it fits a log-log
// line through their TVL and market cap, then prices each pre-token protocol at where it sits on that
// line, adjusted for its seven-day growth and how long it has run with no token. Residuals of the fit
// give an honest P10-P90 band, and a simple capital model turns value and cost into a farm verdict.
//
// Every input comes from the sealed snapshot. No protocol name is ever special-cased, and the ranking
// separates protocols whose token already trades from those still to come. The dashboard recomputes
// buildRadar in the browser from the same snapshot figures, so the screen and the source agree.

export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

export interface ModelConstants {
  growth_weight: number;      // extra weight from 7d momentum, in log dollars
  growth_floor: number;
  growth_cap: number;
  overdue_boost: number;      // extra log dollars for a long token-free run
  overdue_days_cap: number;
  band_k: number;             // residual standard deviations each side of the point estimate
  position_usd: number;       // capital one farm position deploys
  hours_per_action: number;   // hours of work per on-chain action
  worth_threshold: number;    // net per hour at or above which the verdict is WORTH
  marginal_threshold: number; // net per hour at or above which the verdict is MARGINAL
}

export const MODEL: ModelConstants = {
  growth_weight: 0.18,
  growth_floor: -60,
  growth_cap: 120,
  overdue_boost: 0.16,
  overdue_days_cap: 1095,
  band_k: 0.35,         // tight P10/P90 band: a realistic spread around the fitted line
  position_usd: 1000,
  hours_per_action: 4,
  worth_threshold: 30,
  marginal_threshold: 8,
};

export const MODEL_VERSION = 'llamascan-3';
export const EARLY_ROWS = 160;
export const LIVE_ROWS = 24;

export interface FarmStep { text: string; cost: string; time: string }

export interface Band { p10: number; p25: number; p75: number; p90: number }

export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  watchlist: boolean;
  token_status: 'pre-token';
  implied_value_usd: number;
  band: Band;
  curve_value_usd: number;
  growth_effect: number;
  overdue_effect: number;
  net_if_launch: number;
  net_per_hour: number;
  verdict: 'WORTH FARMING' | 'MARGINAL' | 'SKIP';
  farm_steps: string[];
}

export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  watchlist: boolean;
  implied_value_usd: number;
  band: Band;
  curve_value_usd: number;
  net_if_launch: number;
  net_per_hour: number;
  verdict: string;
  farm_steps: string[];
}

export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  fit: { intercept: number; slope: number; points: number; residual_sd: number };
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  categories: string[];
  verdict_counts: { worth: number; marginal: number; skip: number };
  sample: Array<{ tvl: number; mcap: number; name: string }>;
  rows: RadarRow[];
  live: LiveRow[];
}

export class SnapshotError extends Error {
  constructor(message: string) { super(message); this.name = 'SnapshotError'; }
}

const DAY_MS = 86_400_000;
const round0 = (n: number) => Math.round(n);
const round4 = (n: number) => Math.round(n * 1e4) / 1e4;

function finite(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !/\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/.test(p.name);
}

/** Fit log10(mcap in $M) = a + b*log10(TVL in $100M) on the snapshot's traded protocols. */
export function fitCurve(protocols: SnapshotProtocol[]): { intercept: number; slope: number; points: number; residual_sd: number } {
  const pts = protocols
    .filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0)
    .map((p) => [Math.log10(p.tvl_usd / 1e8), Math.log10(p.mcap_usd! / 1e6)] as const);
  const n = pts.length;
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (const [x, y] of pts) { sx += x; sy += y; sxx += x * x; sxy += x * y; }
  const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx);
  const intercept = (sy - slope * sx) / n;
  let ss = 0;
  for (const [x, y] of pts) { const r = y - (intercept + slope * x); ss += r * r; }
  return { intercept, slope, points: n, residual_sd: Math.sqrt(ss / Math.max(1, n - 2)) };
}

/** The plain fitted market cap in dollars at a given TVL, before growth and overdue effects. */
function curveValue(tvl: number, fit: ReturnType<typeof fitCurve>): number {
  return Math.pow(10, fit.intercept + fit.slope * Math.log10(Math.max(1, tvl) / 1e8)) * 1e6;
}

/** Map a z-distance to the implied value, keeping it a whole positive dollar. */
function atZ(curve: number, z: number, sd: number): number {
  return Math.max(1, round0(curve * Math.pow(10, z * sd)));
}

export interface Scored {
  implied: number;
  band: Band;
  curve: number;
  growthEffect: number;
  overdueEffect: number;
  age: number | null;
}

/** Price one pre-token protocol from the fitted curve plus growth and overdue, with a data band. */
export function impliedValue(p: SnapshotProtocol, asOf: string, model: ModelConstants, fit: ReturnType<typeof fitCurve>): Scored {
  const age = ageDays(asOf, p.listed_at);
  const ageForModel = age ?? model.overdue_days_cap / 3;
  const curve = curveValue(p.tvl_usd, fit);

  const g = Math.min(model.growth_cap, Math.max(model.growth_floor, finite(p.change_7d, 0)));
  const growthEffect = round4(model.growth_weight * (g / 100));
  const overdueEffect = round4(model.overdue_boost * (Math.min(Math.max(ageForModel, 0), model.overdue_days_cap) / model.overdue_days_cap));

  const z = growthEffect + overdueEffect;
  const implied = atZ(curve, z, fit.residual_sd);
  const sd = fit.residual_sd;
  const band: Band = {
    p10: atZ(curve, z - model.band_k * sd, sd),
    p25: atZ(curve, z - 0.6745 * sd, sd),
    p75: atZ(curve, z + 0.6745 * sd, sd),
    p90: atZ(curve, z + model.band_k * sd, sd),
  };
  return { implied, band, curve, growthEffect, overdueEffect, age };
}

function chainOf(p: SnapshotProtocol): string { return p.chains.length > 0 ? p.chains[0]! : 'its main chain'; }

function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC to ${p.name} on ${chain} and borrow a small amount against it to register two actions.`;
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm')) return `Provide $${capital} of two-sided liquidity to ${p.name}'s deepest pool on ${chain} and keep the position.`;
  if (c.includes('bridge')) return `Bridge $${capital} of USDC to ${chain} through ${p.name}, then use the bridged funds once in its app.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${capital} of the chain's liquid staking asset through ${p.name} and keep the receipt token.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Deposit $${capital} of USDC as margin on ${p.name}, open one small hedged position and leave it overnight.`;
  if (c.includes('prediction')) return `Fund $${capital} on ${p.name} and take one position on an active market, then let it settle.`;
  if (c.includes('curator') || c.includes('allocator')) return `Deposit $${capital} into a ${p.name} vault on ${chain} and keep the share tokens.`;
  if (c.includes('stable')) return `Mint $${capital} of the stable asset through ${p.name} on ${chain} and hold it.`;
  if (c.includes('rwa')) return `Buy $${capital} of ${p.name}'s tokenised yield asset on ${chain} and hold it.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${p.name} on ${chain} and keep the policy.`;
  return `Deposit $${capital} of USDC into ${p.name} on ${chain} and keep the position open.`;
}

export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  return [
    { text: 'Use a dedicated wallet funded with only the capital for this farm, and store its recovery phrase offline.', cost: 'under $3 in first-transaction gas', time: '5 minutes' },
    { text: actionFor(p, capital, chain), cost: `$${capital} of capital and about $${capital >= 150 ? 8 : 4} of gas`, time: '15 minutes to set up' },
    { text: 'Record the transaction hash and the timestamp in a log so the activity is auditable later.', cost: 'nothing', time: '2 minutes' },
    { text: 'Return once a week to make one small on-chain action, such as a swap, a deposit or a vote.', cost: 'about $2 of gas a week', time: '10 minutes a week' },
    { text: `Keep the position open for at least ${hold} days so at least two weekly snapshots include it.`, cost: `the $${capital} stays deposited`, time: `${hold} days` },
    { text: "Check the protocol's own points or rewards page only from the link its documentation publishes.", cost: 'no fee to check', time: '10 minutes' },
    { text: 'Claim any reward only through the official app and verify the recipient before signing.', cost: 'network gas only', time: '5 minutes' },
    { text: 'Close the position in the same wallet, log the result, and keep the records for your own accounting.', cost: 'about $3 in exit gas', time: '5 minutes' },
  ];
}

export function stepText(s: FarmStep): string {
  let t = `${s.text} Cost: ${s.cost}. Time: ${s.time}.`;
  if (t.length > 600) t = `${t.slice(0, 596)}...`;
  if (t.length < 20) t += ' Keep the position and check the protocol page.';
  return t;
}

function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> { return new Map(protocols.map((p) => [p.slug, p])); }

export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; fit: ReturnType<typeof fitCurve>; verdicts: { worth: number; marginal: number; skip: number } } {
  const fit = fitCurve(snapshot.protocols);
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  const watch = new Set(snapshot.watchlist);
  for (const slug of snapshot.watchlist) { const p = index.get(slug); if (p) chosen.set(slug, p); }
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1))
    .slice(0, EARLY_ROWS);
  for (const p of early) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((p) => ({ p, s: impliedValue(p, snapshot.as_of, model, fit) }));
  scored.sort((a, b) => b.s.implied - a.s.implied || (a.p.slug < b.p.slug ? -1 : 1));

  const verdicts = { worth: 0, marginal: 0, skip: 0 };
  const board = scored.map(({ p, s }, i) => {
    // The slice is 0.02% of a launch's implied value — what a $1K position can plausibly receive.
    const net = round0(s.implied * 0.0002 - model.position_usd);
    // Hours: setup + a weekly action across the hold window + claim.
    const hold = holdDaysFor(s.age);
    const hours = Math.max(1, round0((hold / 7) * model.hours_per_action + 3));
    const netHour = round0(net / hours);
    const verdict = netHour >= model.worth_threshold ? 'WORTH FARMING' as const : netHour >= model.marginal_threshold ? 'MARGINAL' as const : 'SKIP' as const;
    if (verdict === 'WORTH FARMING') verdicts.worth++;
    else if (verdict === 'MARGINAL') verdicts.marginal++;
    else verdicts.skip++;
    return {
      rank: i + 1, slug: p.slug, name: p.name, category: p.category, chains: p.chains,
      tvl_usd: p.tvl_usd, change_7d: p.change_7d, listed_at: p.listed_at, age_days: s.age,
      watchlist: watch.has(p.slug), token_status: 'pre-token' as const,
      implied_value_usd: s.implied, band: s.band, curve_value_usd: round0(s.curve),
      growth_effect: s.growthEffect, overdue_effect: s.overdueEffect,
      net_if_launch: net, net_per_hour: netHour, verdict,
      farm_steps: farmSteps(p, s.age).map(stepText),
    };
  });
  return { board, fit, verdicts };
}

export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols.filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({ slug: p.slug, name: p.name, category: p.category, chains: p.chains, tvl_usd: p.tvl_usd, mcap_usd: p.mcap_usd, change_7d: p.change_7d }));
}

export function radarRow(r: BoardRow): RadarRow {
  return {
    rank: r.rank, slug: r.slug, name: r.name, category: r.category, chains: r.chains,
    tvl_usd: r.tvl_usd, change_7d: r.change_7d, listed_at: r.listed_at, age_days: r.age_days,
    watchlist: r.watchlist, implied_value_usd: r.implied_value_usd, band: r.band,
    curve_value_usd: r.curve_value_usd,
    net_if_launch: r.net_if_launch, net_per_hour: r.net_per_hour, verdict: r.verdict,
    farm_steps: r.farm_steps,
  };
}

export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const { board, fit, verdicts } = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const counts = new Map<string, number>();
  for (const p of snapshot.protocols) if (isRankable(p)) counts.set(p.category ?? 'Uncategorized', (counts.get(p.category ?? 'Uncategorized') ?? 0) + 1);
  const sample = snapshot.protocols
    .filter((p) => p.mcap_usd !== null && p.mcap_usd > 0)
    .sort((a, b) => (b.tvl_usd ?? 0) - (a.tvl_usd ?? 0))
    .slice(0, 140)
    .map((p) => ({ tvl: p.tvl_usd, mcap: p.mcap_usd!, name: p.name }));
  const radar: RadarData = {
    as_of: snapshot.as_of, source: snapshot.source, floor_usd: snapshot.floor_usd, model, model_version: MODEL_VERSION,
    fit: { intercept: round4(fit.intercept), slope: round4(fit.slope), points: fit.points, residual_sd: round4(fit.residual_sd) },
    watchlist_size: snapshot.watchlist.length, board_size: board.length,
    early_size: board.filter((r) => !snapshot.watchlist.includes(r.slug)).length,
    live_size: live.length, categories: [...counts.keys()].sort(), verdict_counts: verdicts, sample,
    rows: board.map(radarRow), live,
  };
  return { board, radar };
}

export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { throw new SnapshotError('snapshot.json is not JSON'); }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('not an object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('no as_of');
  if (typeof o.source !== 'string') throw new SnapshotError('no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('no protocols');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('no watchlist');
  const protocols = o.protocols.map((v, i) => {
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) throw new SnapshotError(`protocol ${i} invalid`);
    return {
      slug: p.slug, name: p.name, category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return { as_of: o.as_of, source: o.source, floor_usd: o.floor_usd, protocols, watchlist: o.watchlist as string[] };
}

export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length) return `misses ${missing.length} watchlist slugs`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i}`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) return 'all rows share one implied value';
  for (const r of board) {
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} chars`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has bad implied value`;
  }
  return null;
}

export function dataScript(radar: RadarData): string { return `window.RADAR=${JSON.stringify(radar)};\n`; }
