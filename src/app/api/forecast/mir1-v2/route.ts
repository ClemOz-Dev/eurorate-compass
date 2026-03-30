import { NextResponse } from "next/server";
import { fetchDbnomicsSeriesWithObservations } from "@/lib/dbnomics";
import { forecastMir1V2, FeatureSeries, ForecastHorizon } from "@/lib/forecast/mir1-v2";

const TARGET = {
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

function alignByPeriod(params: {
  target: { period: string; value: number }[];
  features: Record<string, { period: string; value: number }[]>;
}) {
  const periodSet = new Set(params.target.map((p) => p.period));
  for (const key of Object.keys(params.features)) {
    const s = new Set(params.features[key].map((p) => p.period));
    for (const p of Array.from(periodSet)) {
      if (!s.has(p)) periodSet.delete(p);
    }
  }

  const periods = Array.from(periodSet).sort();
  const alignedTarget = periods.map((period) => {
    const found = params.target.find((x) => x.period === period);
    if (!found) throw new Error("align: target period missing");
    return { period, value: found.value };
  });

  const alignedFeatures: Record<string, { period: string; value: number }[]> = {};
  for (const key of Object.keys(params.features)) {
    alignedFeatures[key] = periods.map((period) => {
      const found = params.features[key].find((x) => x.period === period);
      if (!found) throw new Error("align: feature period missing");
      return { period, value: found.value };
    });
  }

  return { periods, alignedTarget, alignedFeatures };
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const fitWindowMonths = Math.max(
    24,
    Number(url.searchParams.get("fitWindow") ?? DEFAULT_FIT_WINDOW_MONTHS),
  );

  const seriesTarget = await fetchDbnomicsSeriesWithObservations({
    provider: TARGET.provider,
    dataset: TARGET.dataset,
    series: TARGET.series,
  });

  const featureSeriesPoints: Record<string, { period: string; value: number }[]> = {};
  for (const f of FEATURES) {
    const pts = await fetchDbnomicsSeriesWithObservations({
      provider: f.provider,
      dataset: f.dataset,
      series: f.series,
    });
    featureSeriesPoints[f.key] = pts;
  }

  const { alignedTarget, alignedFeatures } = alignByPeriod({
    target: seriesTarget,
    features: featureSeriesPoints,
  });

  const forecast = await forecastMir1V2({
    target: alignedTarget,
    features: alignedFeatures,
    horizonMonths: HORIZONS,
    fitWindowMonths,
  });

  const forecasts = Object.fromEntries(
    forecast.horizons.map((h) => [
      h.horizonMonths,
      { period: h.period, median: h.median, low: h.low, high: h.high },
    ]),
  );

  return NextResponse.json({
    ok: true,
    asOf: new Date().toISOString(),
    target: {
      ...TARGET,
    },
    model: {
      type: "OLS (lagged features) + AR(1) simulation of features + residual bootstrap",
      fitWindowMonths,
      horizonsMonths: HORIZONS,
      sampleSizeAlignedMonths: alignedTarget.length,
      diagnostics: forecast.diagnostics,
    },
    forecasts,
  });
}

