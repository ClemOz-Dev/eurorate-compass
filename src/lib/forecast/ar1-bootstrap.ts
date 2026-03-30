export type ForecastPoint = {
  horizonMonths: number;
  median: number;
  low: number;
  high: number;
};

function mean(arr: number[]) {
  return arr.reduce((s, x) => s + x, 0) / arr.length;
}

function variance(arr: number[], m: number) {
  return arr.reduce((s, x) => s + (x - m) ** 2, 0) / arr.length;
}

function quantile(sorted: number[], q: number) {
  if (sorted.length === 0) throw new Error("quantile: empty");
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  if (sorted[base + 1] === undefined) return sorted[base];
  return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
}

function addMonthsYYYYMM(yyyyMm: string, monthsToAdd: number) {
  const [yStr, mStr] = yyyyMm.split("-");
  const y = Number(yStr);
  const m = Number(mStr);
  const d = new Date(Date.UTC(y, m - 1, 1));
  d.setUTCMonth(d.getUTCMonth() + monthsToAdd);
  const outY = d.getUTCFullYear();
  const outM = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${outY}-${outM}`;
}

export type Ar1Fit = {
  phi: number;
  c: number;
  fittedAt: { startPeriod: string; endPeriod: string };
  residualsSigma: number;
  lastObservedPeriod: string;
  lastObservedValue: number;
};

export function forecastAr1Bootstrap(params: {
  values: number[];
  periods: string[];
  fitWindow: number;
  horizonsMonths: number[];
  nSimulations?: number;
  lowQuantile?: number;
  highQuantile?: number;
}): { fit: Ar1Fit; points: ForecastPoint[]; timeline: Record<number, string> } {
  const {
    values,
    periods,
    fitWindow,
    horizonsMonths,
    nSimulations = 1200,
    lowQuantile = 0.1,
    highQuantile = 0.9,
  } = params;

  if (values.length !== periods.length) throw new Error("values/periods length mismatch");
  if (values.length < fitWindow + 2) throw new Error("Not enough data for fitWindow");

  const end = values.length;
  const start = Math.max(1, end - fitWindow);
  const y = values.slice(start, end);
  const x = values.slice(start - 1, end - 1);

  const mx = mean(x);
  const my = mean(y);

  const varX = variance(x, mx);
  if (varX === 0) {
    const last = values[values.length - 1];
    return {
      fit: {
        phi: 0,
        c: last,
        fittedAt: { startPeriod: periods[start], endPeriod: periods[end - 1] },
        residualsSigma: 0,
        lastObservedPeriod: periods[periods.length - 1],
        lastObservedValue: last,
      },
      points: horizonsMonths.map((h) => ({ horizonMonths: h, median: last, low: last, high: last })),
      timeline: Object.fromEntries(horizonsMonths.map((h) => [h, addMonthsYYYYMM(periods[periods.length - 1], h)])),
    };
  }

  const covXY = x.reduce((s, xi, i) => s + (xi - mx) * (y[i] - my), 0) / x.length;
  const phi = covXY / varX;
  const c = my - phi * mx;

  const residuals = y.map((yi, i) => yi - (c + phi * x[i]));
  const residualMean = mean(residuals);
  const residualVar = variance(residuals, residualMean);
  const residualSigma = Math.sqrt(residualVar);

  const lastValue = values[values.length - 1];
  const lastPeriod = periods[periods.length - 1];

  const pointsByHorizon: Record<number, number[]> = {};
  for (const h of horizonsMonths) pointsByHorizon[h] = [];

  for (let sim = 0; sim < nSimulations; sim++) {
    let simY = lastValue;
    for (let step = 1; step <= Math.max(...horizonsMonths); step++) {
      const e = residuals[Math.floor(Math.random() * residuals.length)];
      simY = c + phi * simY + e;
      if (horizonsMonths.includes(step)) {
        pointsByHorizon[step].push(simY);
      }
    }
  }

  const timeline = Object.fromEntries(
    horizonsMonths.map((h) => [h, addMonthsYYYYMM(lastPeriod, h)]),
  ) as Record<number, string>;

  const points: ForecastPoint[] = horizonsMonths
    .slice()
    .sort((a, b) => a - b)
    .map((h) => {
      const arr = pointsByHorizon[h];
      arr.sort((a, b) => a - b);
      return {
        horizonMonths: h,
        median: quantile(arr, 0.5),
        low: quantile(arr, lowQuantile),
        high: quantile(arr, highQuantile),
      };
    });

  return {
    fit: {
      phi,
      c,
      fittedAt: { startPeriod: periods[start], endPeriod: periods[end - 1] },
      residualsSigma: residualSigma,
      lastObservedPeriod: lastPeriod,
      lastObservedValue: lastValue,
    },
    points,
    timeline,
  };
}

