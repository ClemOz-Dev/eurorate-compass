import { forecastMir1V2, FeatureSeries, ForecastHorizon } from "@/lib/forecast/mir1-v2";
import { fetchDbnomicsSeriesWithObservations } from "@/lib/dbnomics";
import { callMistralChatCompletions } from "@/lib/mistral";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const TARGET: {
  provider: string;
  dataset: string;
  series: string;
  label: string;
} = {
  provider: "BDF",
  dataset: "MIR1",
  series: "M.FR.B.A2C.P.R.A.2250U6.EUR.N",
  label: "New loans for house purchase, households, over 10 years, annualised agreed rate",
};

const FEATURES: FeatureSeries[] = [
  {
    key: "depositFacility",
    provider: "BUBA",
    dataset: "BBIN1",
    series: "M.D0.ECB.ECBFAC.EUR.ME",
    label: "ECB deposit facility rate",
  },
  {
    key: "mainRefi",
    provider: "BUBA",
    dataset: "BBIN1",
    series: "M.D0.ECB.ECBMIN.EUR.ME",
    label: "ECB main refinancing rate",
  },
  {
    key: "marginalLending",
    provider: "BUBA",
    dataset: "BBIN1",
    series: "M.D0.ECB.ECBREF.EUR.ME",
    label: "ECB marginal lending facility rate",
  },
  {
    key: "tenYYield",
    provider: "ECB",
    dataset: "FM",
    series: "M.U2.EUR.4F.BB.R_U2_10Y.YLDA",
    label: "10-year benchmark yield (proxy for long rates)",
  },
  {
    key: "hicpHeadline",
    provider: "Eurostat",
    dataset: "prc_hicp_manr",
    series: "M.RCH_A.CP00.EA",
    label: "HICP all-items inflation (Euro area)",
  },
  {
    key: "hicpEnergy",
    provider: "Eurostat",
    dataset: "prc_hicp_manr",
    series: "M.RCH_A.CP04.EA",
    label: "HICP energy inflation (Euro area, official energy category)",
  },
  {
    key: "unemployment",
    provider: "Eurostat",
    dataset: "une_rt_m",
    series: "M.SA.TOTAL.PC_ACT.T.EA20",
    label: "Unemployment rate (Euro area EA20 proxy)",
  },
  {
    key: "ciss",
    provider: "ECB",
    dataset: "CISS",
    series: "M.U2.Z0Z.4F.EC.SOV_EW.IDX",
    label: "CISS sovereign risk stress index (proxy)",
  },
];

const DEFAULT_FIT_WINDOW_MONTHS = 84;
const HORIZONS: ForecastHorizon[] = [12, 24, 36];

export type DashboardResponse = {
  ok: true;
  asOf: string;
  forecast: {
    lastObserved: { period: string; value: number };
    forecasts: Record<
      number,
      { period: string; median: number; low: number; high: number }
    >;
  };
  drivers: Array<{
    key: string;
    label: string;
    current: number | null;
    currentPeriod: string | null;
    change3m_pp: number | null;
    change12m_pp: number | null;
  }>;
  synthesis: {
    title: string;
    summary: string;
    actus: string[];
    riskFlags: Array<{
      label: string;
      direction: "+" | "-" | "±";
      explanation: string;
    }>;
  };
};

type SnapshotFile = {
  updatedAt: string;
  data: DashboardResponse;
};

const SNAPSHOT_PATH = path.join(process.cwd(), "data", "dashboard.snapshot.json");

let memoryCache: DashboardResponse | null = null;

function safeJsonParse<T>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

function parseSynthesisFromModelOutput(
  raw: string,
): DashboardResponse["synthesis"] | null {
  const direct = safeJsonParse<DashboardResponse["synthesis"]>(raw);
  if (direct) return direct;

  const firstBrace = raw.indexOf("{");
  const lastBrace = raw.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    const slice = raw.slice(firstBrace, lastBrace + 1);
    const parsed = safeJsonParse<DashboardResponse["synthesis"]>(slice);
    if (parsed) return parsed;
  }

  return null;
}

function buildDeterministicFallbackSynthesis(params: {
  currentPeriod: string;
  currentValue: number;
  forecasts: DashboardResponse["forecast"]["forecasts"];
}): DashboardResponse["synthesis"] {
  const f12 = params.forecasts[12];
  const f24 = params.forecasts[24];
  const f36 = params.forecasts[36];
  return {
    title: "French Mortgage Outlook",
    summary:
      `As of ${params.currentPeriod}, the reference mortgage rate is ${params.currentValue.toFixed(2)}%. ` +
      `Median scenarios point to ${f12.median.toFixed(2)}% at 12 months, ${f24.median.toFixed(2)}% at 24 months, and ${f36.median.toFixed(2)}% at 36 months. ` +
      `Uncertainty remains material over longer horizons and should be interpreted as a scenario range, not a commitment.`,
    actus: [
      `12m scenario range: [${f12.low.toFixed(2)}%; ${f12.high.toFixed(2)}%].`,
      `24m scenario range: [${f24.low.toFixed(2)}%; ${f24.high.toFixed(2)}%].`,
      `36m scenario range: [${f36.low.toFixed(2)}%; ${f36.high.toFixed(2)}%].`,
    ],
    riskFlags: [
      {
        label: "Model uncertainty",
        direction: "±",
        explanation: "Forecast ranges widen with horizon and require conservative interpretation.",
      },
    ],
  };
}

async function readSnapshotFile(): Promise<DashboardResponse | null> {
  try {
    const raw = await readFile(SNAPSHOT_PATH, "utf8");
    const parsed = safeJsonParse<SnapshotFile>(raw);
    if (!parsed?.data) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

async function writeSnapshotFile(data: DashboardResponse): Promise<void> {
  try {
    await mkdir(path.dirname(SNAPSHOT_PATH), { recursive: true });
    const payload: SnapshotFile = { updatedAt: new Date().toISOString(), data };
    await writeFile(SNAPSHOT_PATH, JSON.stringify(payload, null, 2), "utf8");
  } catch {
  }
}

export async function getDashboardSnapshot(): Promise<DashboardResponse | null> {
  if (memoryCache) return memoryCache;
  const fromFile = await readSnapshotFile();
  if (fromFile) memoryCache = fromFile;
  return fromFile;
}

export async function rebuildDashboardSnapshot(
  fitWindow: number = DEFAULT_FIT_WINDOW_MONTHS,
): Promise<DashboardResponse> {
  const seriesTarget = await fetchDbnomicsSeriesWithObservations({
    provider: TARGET.provider,
    dataset: TARGET.dataset,
    series: TARGET.series,
  });

  const featurePoints: Record<string, { period: string; value: number }[]> = {};
  for (const f of FEATURES) {
    featurePoints[f.key] = await fetchDbnomicsSeriesWithObservations({
      provider: f.provider,
      dataset: f.dataset,
      series: f.series,
    });
  }

  const periods = seriesTarget.map((p) => p.period).sort();

  const alignedTarget = periods.map((period) => {
    const found = seriesTarget.find((x) => x.period === period);
    if (!found) throw new Error("align: target period missing");
    return found;
  });

  const alignedFeatures: Record<string, { period: string; value: number }[]> = {};
  const alignedFeatureSourcePeriods: Record<string, string[]> = {};
  for (const key of Object.keys(featurePoints)) {
    const source = featurePoints[key].slice().sort((a, b) => a.period.localeCompare(b.period));
    let idx = 0;
    let lastSeen: { period: string; value: number } | null = null;
    const values: { period: string; value: number }[] = [];
    const sourcePeriods: string[] = [];
    for (const period of periods) {
      while (idx < source.length && source[idx].period <= period) {
        lastSeen = source[idx];
        idx += 1;
      }
      if (lastSeen) {
        values.push({ period, value: lastSeen.value });
        sourcePeriods.push(lastSeen.period);
      } else {
        values.push({ period, value: Number.NaN });
        sourcePeriods.push("");
      }
    }
    alignedFeatures[key] = values;
    alignedFeatureSourcePeriods[key] = sourcePeriods;
  }

  const validIndices = periods
    .map((_, i) => i)
    .filter((i) => Object.keys(alignedFeatures).every((k) => Number.isFinite(alignedFeatures[k][i].value)));

  const finalPeriods = validIndices.map((i) => periods[i]);
  const finalTarget = validIndices.map((i) => alignedTarget[i]);
  const finalFeatures: Record<string, { period: string; value: number }[]> = {};
  const finalFeatureSourcePeriods: Record<string, string[]> = {};
  for (const key of Object.keys(alignedFeatures)) {
    finalFeatures[key] = validIndices.map((i) => alignedFeatures[key][i]);
    finalFeatureSourcePeriods[key] = validIndices.map((i) => alignedFeatureSourcePeriods[key][i]);
  }

  const last = finalTarget[finalTarget.length - 1];

  const forecast = await forecastMir1V2({
    target: finalTarget,
    features: finalFeatures,
    horizonMonths: [...HORIZONS],
    fitWindowMonths: fitWindow,
  });

  const forecasts = Object.fromEntries(
    forecast.horizons.map((p) => [
      p.horizonMonths,
      {
        period: p.period,
        median: p.median,
        low: p.low,
        high: p.high,
      },
    ]),
  ) as DashboardResponse["forecast"]["forecasts"];

  const apiKey = process.env.MISTRAL_API_KEY;
  if (!apiKey) {
    throw new Error("Missing MISTRAL_API_KEY in environment");
  }

  const last12 = finalTarget.slice(Math.max(0, finalTarget.length - 12));
  const idxLast = finalTarget.length - 1;
  const idx3m = Math.max(0, idxLast - 3);
  const idx12m = Math.max(0, idxLast - 12);

  const drivers = FEATURES.map((f) => {
    const seriesPts = finalFeatures[f.key];
    const sourcePeriods = finalFeatureSourcePeriods[f.key];
    const lastVal = seriesPts[idxLast]?.value;
    const v3 = seriesPts[idx3m]?.value;
    const v12 = seriesPts[idx12m]?.value;
    return {
      key: f.key,
      label: f.label,
      current: lastVal,
      currentPeriod: sourcePeriods[idxLast] ?? finalPeriods[idxLast] ?? null,
      change3m_pp: lastVal != null && v3 != null ? lastVal - v3 : null,
      change12m_pp: lastVal != null && v12 != null ? lastVal - v12 : null,
    };
  });

  const promptInput = {
    note:
      "All rates/indices are indicators used to model the target: annualised agreed mortgage interest rate on new loans (PFIT > 10 years). This is a statistical forecast, not a guarantee.",
    current: { period: last.period, value: last.value },
    recent12Months: last12.map((d) => ({ period: d.period, value: d.value })),
    drivers,
    forecastHorizons: forecasts,
    forecastSpreads_pp: Object.fromEntries(
      Object.entries(forecasts).map(([h, v]) => [h, v.high - v.low]),
    ),
    model: {
      fitWindowMonths: fitWindow,
      diagnostics: forecast.diagnostics,
      ols: forecast.model?.ols,
    },
  };

  const system = `You are a conservative macro-risk analyst writing decision-ready finance summaries in English.
Return results in EXACTLY valid JSON only (no markdown, no extra keys).
Hard rules:
- Never use the words "bps" or "bp" or "basis points".
- Express all changes and uncertainties in "percentage points (pp)".
- When you need uncertainty size, use the provided "forecastSpreads_pp" values.
- When you describe recent moves, use "drivers.change3m_pp" / "drivers.change12m_pp" (already in pp) and/or "current - prior" in pp.
 - Do not use promotional or optimistic language.
 - Prefer neutral, risk-aware wording and explicitly mention uncertainty.
If the prompt asks for a numeric move, do not convert between units.`;

  const user = `Create a short professional dashboard synthesis about mortgage rates in France.
Use the provided JSON input.

Requirements (schema):
{
  "title": string,
  "summary": string,
  "actus": string[],
  "riskFlags": [
    {
      "label": string,
      "direction": "+" | "-" | "±",
      "explanation": string
    }
  ]
}

Formatting/unit constraints:
- Do not use any relative percentage like "13.8% drop" unless it is explicitly in percentage points (pp).
- Any "move" must be stated in percentage points, using provided pp fields or provided forecast spreads (high-low).
- Do not mention basis points.
- Keep tone formal, concise, and risk-first.
- Avoid suggesting aggressive optimistic scenarios as baseline.

Input JSON:
${JSON.stringify(promptInput)}`;

  const content = await callMistralChatCompletions({
    apiKey,
    model: "mistral-small-latest",
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    maxTokens: 800,
    temperature: 0.4,
  });

  const parsed = parseSynthesisFromModelOutput(content);
  const synthesis = parsed ?? buildDeterministicFallbackSynthesis({
    currentPeriod: last.period,
    currentValue: last.value,
    forecasts,
  });

  const data: DashboardResponse = {
    ok: true,
    asOf: new Date().toISOString(),
    forecast: {
      lastObserved: { period: last.period, value: last.value },
      forecasts,
    },
    drivers,
    synthesis,
  };

  memoryCache = data;
  await writeSnapshotFile(data);
  return data;
}
