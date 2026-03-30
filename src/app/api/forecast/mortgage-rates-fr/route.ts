import { NextResponse } from "next/server";
import { fetchDbnomicsSeriesWithObservations } from "@/lib/dbnomics";
import { forecastAr1Bootstrap } from "@/lib/forecast/ar1-bootstrap";

const SERIES_PROVIDER = "BDF";
const SERIES_DATASET = "MIR1";
const SERIES_CODE = "M.FR.B.A2C.P.R.A.2250U6.EUR.N";

const DEFAULT_FIT_WINDOW_MONTHS = 60;
const HORIZONS = [12, 24, 36] as const;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const fitWindow = Math.max(24, Number(url.searchParams.get("fitWindow") ?? DEFAULT_FIT_WINDOW_MONTHS));

  const data = await fetchDbnomicsSeriesWithObservations({
    provider: SERIES_PROVIDER,
    dataset: SERIES_DATASET,
    series: SERIES_CODE,
  });

  const periods = data.map((d) => d.period);
  const values = data.map((d) => d.value);

  const lastObserved = data[data.length - 1];
  const lastValue = lastObserved?.value ?? NaN;

  const forecast = forecastAr1Bootstrap({
    values,
    periods,
    fitWindow,
    horizonsMonths: [...HORIZONS],
  });

  return NextResponse.json({
    ok: true,
    asOf: new Date().toISOString(),
    series: {
      provider: SERIES_PROVIDER,
      dataset: SERIES_DATASET,
      code: SERIES_CODE,
      unit: "percent_per_year",
      label:
        "Taux d'intérêt annuel (convenu) sur nouveaux crédits habitat aux ménages, période de fixation initiale > 10 ans",
      lastObserved: {
        period: lastObserved.period,
        value: lastValue,
      },
    },
    model: {
      type: "AR(1) bootstrap residuals",
      fitWindowMonths: fitWindow,
      horizonsMonths: HORIZONS,
      fitted: forecast.fit,
    },
    forecasts: Object.fromEntries(
      forecast.points.map((p) => [
        p.horizonMonths,
        {
          period: forecast.timeline[p.horizonMonths],
          median: p.median,
          low: p.low,
          high: p.high,
        },
      ]),
    ),
    disclaimer:
      "Prévision probabiliste basée sur un modèle statistique simple sur une série historique. Ce n'est pas une garantie du taux d'offre bancaire futur (marge banque, changements produit, etc.).",
  });
}

