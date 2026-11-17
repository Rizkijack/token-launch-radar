// LLAMASCAN value model v4 - a fitted curve, an honest band, and a farm verdict.
//
// The snapshot is the only source of figures. Nothing is keyed to a protocol name. A log-log line
// is fitted through the snapshot protocols that already trade, and each pre-token protocol is
// priced at its position on that line, shifted by seven-day TVL growth and by the time it has
// run without a recorded token. Residuals of the fit set a real P10/P90 band. A stated capital
// assumption turns value and effort into a farm verdict.
//
// v4 fixes two defects of v3: the band quantiles were ordered P25 < P10 and P90 < P75, and the
// dashboard drew the fitted line two log units to the right of where the fit actually sits.

import type { Snapshot, SnapshotProtocol } from './types.ts';
import { SnapshotError } from './types.ts';

export { SnapshotError } from './types.ts';
export type { Snapshot, SnapshotProtocol } from './types.ts';

export interface ModelConstants {
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  overdue_boost: number;
  overdue_days_cap: number;
  z80: number;
  z50: number;
  airdrop_share: number;
  position_usd: number;
  hours_per_action: number;
  worth_threshold: number;
  marginal_threshold: number;
  value_cap: number;
}

export const MODEL: ModelConstants = {
  growth_weight: 0.18,
  growth_floor: -60,
  growth_cap: 120,
  overdue_boost: 0.16,
  overdue_days_cap: 1095,
  z80: 1.2816,
  z50: 0.6745,
  airdrop_share: 0.0002,
  position_usd: 1000,
  hours_per_action: 4,
  worth_threshold: 30,
  marginal_threshold: 8,
  value_cap: 100_000_000_000_000,
};

export const MODEL_VERSION = 'llamascan-4';
export const EARLY_ROWS = 260;
export const LIVE_ROWS = 24;

export interface Band { p10: number; p25: number; p75: number; p90: number }
export type Verdict = 'WORTH FARMING' | 'MARGINAL' | 'SKIP';

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
  implied_value_usd: number;
  band: Band;
  curve_value_usd: number;
  growth_effect: number;
  overdue_effect: number;
  net_if_launch: number;
  net_per_hour: number;
  verdict: Verdict;
  farm_steps: string[];
}

export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number;
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
  family_counts: Array<{ family: string; count: number }>;
  chain_counts: Array<{ chain: string; count: number }>;
  watch_rows: Array<{ slug: string; name: string; tvl_usd: number; implied_value_usd: number; verdict: Verdict }>;
  sample: Array<{ tvl: number; mcap: number; name: string }>;
  rows: BoardRow[];
  live: LiveRow[];
}

export interface Fit { intercept: number; slope: number; points: number; residual_sd: number }

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

/** Fit log10(mcap / $1M) = a + b * log10(TVL / $100M) on the snapshot protocols that trade. */
export function fitCurve(protocols: SnapshotProtocol[]): Fit {
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

/** Plain fitted market cap in dollars at a TVL, before growth and overdue effects. */
export function curveValue(tvl: number, fit: Fit): number {
  const x = Math.log10(Math.max(1, tvl) / 1e8);
  return Math.pow(10, fit.intercept + fit.slope * x) * 1e6;
}

/** Convert a log-distance from the fitted line into a whole positive dollar value. */
function atZ(curve: number, z: number, sd: number, cap: number): number {
  const raw = curve * Math.pow(10, z * sd);
  return Math.max(1, Math.min(cap, round0(raw)));
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
export function impliedValue(p: SnapshotProtocol, asOf: string, model: ModelConstants, fit: Fit): Scored {
  const age = ageDays(asOf, p.listed_at);
  const ageForModel = age ?? model.overdue_days_cap / 3;
  const curve = curveValue(p.tvl_usd, fit);

  const g = Math.min(model.growth_cap, Math.max(model.growth_floor, finite(p.change_7d, 0)));
  const growthEffect = round4(model.growth_weight * (g / 100));
  const overdueEffect = round4(model.overdue_boost * (
    Math.min(Math.max(ageForModel, 0), model.overdue_days_cap) / model.overdue_days_cap
  ));

  const z = growthEffect + overdueEffect;
  const sd = fit.residual_sd;
  const cap = model.value_cap;
  // Quantiles are ordered by construction: -1.2816 < -0.6745 < 0 < 0.6745 < 1.2816,
  // and sd is positive, so P10 <= P25 <= point <= P75 <= P90.
  const band: Band = {
    p10: atZ(curve, z - model.z80 * sd, sd, cap),
    p25: atZ(curve, z - model.z50 * sd, sd, cap),
    p75: atZ(curve, z + model.z50 * sd, sd, cap),
    p90: atZ(curve, z + model.z80 * sd, sd, cap),
  };
  const implied = atZ(curve, z, sd, cap);
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
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral') || c.includes('credit')) {
    return `Supply $` + capital + ` of USDC to ` + p.name + ` on ` + chain + ` and borrow a small amount against it to register two distinct actions.`;
  }
  if (c.includes('dex') || c.includes('yield') || c.includes('farming') || c.includes('farm')) {
    return `Provide $` + capital + ` of two-sided liquidity to the deepest ` + p.name + ` pool on ` + chain + ` and hold the position.`;
  }
  if (c.includes('bridge')) {
    return `Bridge $` + capital + ` of USDC to ` + chain + ` through ` + p.name + `, then use the bridged funds once in its app.`;
  }
  if (c.includes('staking') || c.includes('restak')) {
    return `Stake $` + capital + ` of the chain's liquid staking asset through ` + p.name + ` and keep the receipt token.`;
  }
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('options')) {
    return `Deposit $` + capital + ` of USDC as margin on ` + p.name + `, open one small hedged position and leave it overnight.`;
  }
  if (c.includes('prediction')) {
    return `Fund $` + capital + ` on ` + p.name + ` and take one position on an active market, then let it settle.`;
  }
  if (c.includes('curator') || c.includes('allocator') || c.includes('vault')) {
    return `Deposit $` + capital + ` into a ` + p.name + ` vault on ` + chain + ` and keep the share tokens for the full holding window.`;
  }
  if (c.includes('stable')) {
    return `Mint $` + capital + ` of the stable asset through ` + p.name + ` on ` + chain + ` and hold it without swapping.`;
  }
  if (c.includes('rwa') || c.includes('treasury')) {
    return `Buy $` + capital + ` of the tokenised yield asset offered by ` + p.name + ` on ` + chain + ` and hold it.`;
  }
  if (c.includes('insurance')) {
    return `Buy $` + capital + ` of cover from ` + p.name + ` on ` + chain + ` and keep the policy active.`;
  }
  return `Deposit $` + capital + ` of USDC into ` + p.name + ` on ` + chain + ` and keep the position open for the full window.`;
}

function step(text: string, cost: string, time: string): string {
  const s = `${text} Cost: ${cost}. Time: ${time}.`;
  return s.length > 600 ? `${s.slice(0, 596)}...` : s.length < 20 ? `${s} Keep the position.` : s;
}

export function farmSteps(p: SnapshotProtocol, age: number | null): string[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  return [
    step('Fund a dedicated wallet with only this farm capital and keep its recovery phrase offline.', 'under $3 in first-transaction gas', '5 minutes'),
    step(actionFor(p, capital, chain), `$${capital} of capital and about $${capital >= 150 ? 8 : 4} of gas`, '15 minutes to set up'),
    step('Record the transaction hash and the timestamp in a log so the activity can be audited later.', 'nothing', '2 minutes'),
    step('Return once a week to make one small on-chain action, such as a swap, a deposit or a vote.', 'about $2 of gas a week', '10 minutes a week'),
    step(`Keep the position open for at least ${hold} days so two weekly snapshots include it.`, `the $${capital} stays deposited`, `${hold} days`),
    step("Check the protocol's own points or rewards page only from the address its documentation publishes.", 'no fee to check', '10 minutes'),
    step('Claim any reward only through the official app and verify the recipient address before signing.', 'network gas only', '5 minutes'),
    step('Close the position in the same wallet, log the result and keep the records for your own accounting.', 'about $3 in exit gas', '5 minutes'),
  ];
}

function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): {
  board: BoardRow[]; fit: Fit; verdicts: { worth: number; marginal: number; skip: number };
} {
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
    const net = round0(s.implied * model.airdrop_share - model.position_usd);
    const hold = holdDaysFor(s.age);
    const hours = Math.max(1, round0((hold / 7) * model.hours_per_action + 3));
    const netHour = round0(net / hours);
    const verdict: Verdict = netHour >= model.worth_threshold
      ? 'WORTH FARMING' : netHour >= model.marginal_threshold ? 'MARGINAL' : 'SKIP';
    if (verdict === 'WORTH FARMING') verdicts.worth++;
    else if (verdict === 'MARGINAL') verdicts.marginal++;
    else verdicts.skip++;
    return {
      rank: i + 1, slug: p.slug, name: p.name, category: p.category, chains: p.chains,
      tvl_usd: p.tvl_usd, change_7d: p.change_7d, listed_at: p.listed_at, age_days: s.age,
      watchlist: watch.has(p.slug), implied_value_usd: s.implied, band: s.band,
      curve_value_usd: round0(s.curve), growth_effect: s.growthEffect, overdue_effect: s.overdueEffect,
      net_if_launch: net, net_per_hour: netHour, verdict, farm_steps: farmSteps(p, s.age),
    };
  });
  return { board, fit, verdicts };
}

export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols.filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({ slug: p.slug, name: p.name, category: p.category, chains: p.chains,
      tvl_usd: p.tvl_usd, mcap_usd: p.mcap_usd!, change_7d: p.change_7d }));
}

export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const { board, fit, verdicts } = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const family = new Map<string, number>();
  const chain = new Map<string, number>();
  for (const p of snapshot.protocols) {
    if (!isRankable(p)) continue;
    const f = p.category ?? 'Uncategorized';
    family.set(f, (family.get(f) ?? 0) + 1);
    for (const c of p.chains) chain.set(c, (chain.get(c) ?? 0) + 1);
  }
  const sample = snapshot.protocols
    .filter((p) => p.mcap_usd !== null && p.mcap_usd > 0)
    .sort((a, b) => b.tvl_usd - a.tvl_usd)
    .slice(0, 140)
    .map((p) => ({ tvl: p.tvl_usd, mcap: p.mcap_usd!, name: p.name }));
  const watchSet = new Set(snapshot.watchlist);
  const radar: RadarData = {
    as_of: snapshot.as_of, source: snapshot.source, floor_usd: snapshot.floor_usd,
    model, model_version: MODEL_VERSION,
    fit: { intercept: round4(fit.intercept), slope: round4(fit.slope), points: fit.points, residual_sd: round4(fit.residual_sd) },
    watchlist_size: snapshot.watchlist.length, board_size: board.length,
    early_size: board.filter((r) => !watchSet.has(r.slug)).length,
    live_size: live.length,
    categories: [...family.keys()].sort(),
    verdict_counts: verdicts,
    family_counts: [...family.entries()].map(([family, count]) => ({ family, count })).sort((a, b) => b.count - a.count),
    chain_counts: [...chain.entries()].map(([chain, count]) => ({ chain, count })).sort((a, b) => b.count - a.count),
    watch_rows: board.filter((r) => watchSet.has(r.slug)),
    sample, rows: board, live,
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
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`protocol ${i} invalid`);
    }
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

export function boardIssue(board: BoardRow[], snapshot: Snapshot, model: ModelConstants = MODEL): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length) return `misses ${missing.length} watchlist slugs`;
  if (board.length < 100 || board.length > 4000) return `board has ${board.length} rows`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i}`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) return 'all rows share one implied value';
  for (const r of board) {
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > model.value_cap) {
      return `${r.slug} has a bad implied value`;
    }
    if (r.band.p10 > r.band.p25 || r.band.p25 > r.implied_value_usd ||
        r.implied_value_usd > r.band.p75 || r.band.p75 > r.band.p90) return `${r.slug} has an unordered band`;
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} chars`;
  }
  return null;
}

export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
