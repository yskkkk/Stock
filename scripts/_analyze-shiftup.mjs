/**
 * One-off: Shift Up (462870.KQ) analysis via server modules
 */
import { loadStock, fetchScanCandles } from "../server/stock-data.js";
import { buildTechnicalStatusReport } from "../server/technical.js";
import { detectDailyMa5OverMa20 } from "../server/ma-align-detect.js";
import { getActiveTechModelsSync, sumTechScoreWeights } from "../server/picks-tech-models-store.js";
import { loadBuffettIntrinsicValue } from "../server/buffett-intrinsic-input.js";
import { loadValueInvestReturn } from "../server/value-invest-return-input.js";
import { loadStockFundamentals } from "../server/stock-fundamentals.js";

const SYMBOL = "462870.KQ";

function sma(arr, period) {
  const out = [];
  for (let i = 0; i < arr.length; i++) {
    if (i < period - 1) { out.push(null); continue; }
    let s = 0;
    for (let j = i - period + 1; j <= i; j++) s += arr[j];
    out.push(s / period);
  }
  return out;
}

function rsi(closes, period = 14) {
  const out = new Array(closes.length).fill(null);
  if (closes.length < period + 1) return out;
  let avgGain = 0, avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) avgGain += d; else avgLoss -= d;
  }
  avgGain /= period; avgLoss /= period;
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    const gain = d > 0 ? d : 0;
    const loss = d < 0 ? -d : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

function atr(candles, period = 14) {
  const trs = [];
  for (let i = 0; i < candles.length; i++) {
    if (i === 0) {
      trs.push(candles[i].high - candles[i].low);
    } else {
      const h = candles[i].high, l = candles[i].low, pc = candles[i - 1].close;
      trs.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
    }
  }
  return sma(trs, period);
}

async function main() {
  const [daily, weekly, scan, fundamentals, buffett, valueInvest] = await Promise.allSettled([
    loadStock(SYMBOL, "1d", { live: true }),
    loadStock(SYMBOL, "1wk", { live: false }),
    fetchScanCandles(SYMBOL),
    loadStockFundamentals(SYMBOL),
    loadBuffettIntrinsicValue(SYMBOL),
    loadValueInvestReturn(SYMBOL),
  ]);

  const model = getActiveTechModelsSync()[0];
  const weights = model?.weights;

  let techReport = null;
  if (scan.status === "fulfilled" && daily.status === "fulfilled") {
    techReport = buildTechnicalStatusReport(scan.value.candles, weights, {
      dailyMa5OverMa20: detectDailyMa5OverMa20(daily.value.candles ?? []),
    });
  }

  const dCandles = daily.status === "fulfilled" ? daily.value.candles ?? [] : [];
  const wCandles = weekly.status === "fulfilled" ? weekly.value.candles ?? [] : [];
  const closes = dCandles.map(c => c.close);
  const i = closes.length - 1;
  const sma20 = sma(closes, 20);
  const sma50 = sma(closes, 50);
  const sma200 = sma(closes, 200);
  const rsi14 = rsi(closes, 14);
  const atr14 = atr(dCandles, 14);

  const last = dCandles[i];
  const price = daily.status === "fulfilled" ? daily.value.meta?.price : null;

  const swing = {
    price,
    changePercent: daily.status === "fulfilled" ? daily.value.meta?.changePercent : null,
    aboveSma20: sma20[i] != null && closes[i] > sma20[i],
    aboveSma50: sma50[i] != null && closes[i] > sma50[i],
    aboveSma200: sma200[i] != null && closes[i] > sma200[i],
    sma20: sma20[i],
    sma50: sma50[i],
    sma200: sma200[i],
    rsi: rsi14[i],
    atr: atr14[i],
    atrPct: atr14[i] && closes[i] ? (atr14[i] / closes[i]) * 100 : null,
    high60: Math.max(...dCandles.slice(-60).map(c => c.high)),
    high52w: Math.max(...dCandles.slice(-252).map(c => c.high)),
    low52w: Math.min(...dCandles.slice(-252).map(c => c.low)),
    weeklyTrendUp: wCandles.length >= 20 && wCandles.at(-1)?.close > sma(wCandles.map(c => c.close), 20).at(-1),
    distFromHigh60: closes[i] && Math.max(...dCandles.slice(-60).map(c => c.high)) > 0
      ? ((closes[i] / Math.max(...dCandles.slice(-60).map(c => c.high)) - 1) * 100)
      : null,
  };

  console.log(JSON.stringify({
    symbol: SYMBOL,
    name: daily.status === "fulfilled" ? daily.value.meta?.name : "시프트업",
    dailyMeta: daily.status === "fulfilled" ? daily.value.meta : { error: daily.reason?.message },
    techReport,
    techModel: model ? { id: model.id, name: model.name, maxScore: sumTechScoreWeights(model.weights) } : null,
    swing,
    fundamentals: fundamentals.status === "fulfilled" ? fundamentals.value : { error: fundamentals.reason?.message },
    buffett: buffett.status === "fulfilled" ? buffett.value : { error: buffett.reason?.message },
    valueInvest: valueInvest.status === "fulfilled" ? valueInvest.value : { error: valueInvest.reason?.message },
    dailyCandleCount: dCandles.length,
    weeklyCandleCount: wCandles.length,
  }, null, 2));
}

main().catch(e => { console.error(e); process.exit(1); });
