type SeriesPoint = { period: string; value: number };

export type ForecastHorizon = 12 | 24 | 36;

export type FeatureSeries = {
  key: string;
  provider: string;
  dataset: string;
  series: string;
  label: string;
};

export type Mir1V2Forecast = {
  horizons: Array<{
    horizonMonths: ForecastHorizon;
    period: string;
    median: number;
    low: number;
    high: number;
  }>;
};

function mean(arr: number[]) {
  return arr.reduce((s, x) => s + x, 0) / arr.length;
}

function variance(arr: number[], m: number) {
  return arr.reduce((s, x) => s + (x - m) ** 2, 0) / arr.length;
}

function quantile(sortedAsc: number[], q: number) {
  if (sortedAsc.length === 0) throw new Error("quantile: empty");
  const pos = (sortedAsc.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  const a = sortedAsc[base];
  const b = sortedAsc[base + 1];
  if (b === undefined) return a;
  return a + rest * (b - a);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function sampleFromArray(arr: number[]) {
  return arr[Math.floor(Math.random() * arr.length)] ?? 0;
}

function winsorized(arr: number[], lowQ = 0.05, highQ = 0.95) {
  if (arr.length === 0) return [0];
  const sorted = arr.slice().sort((a, b) => a - b);
  const lo = quantile(sorted, lowQ);
  const hi = quantile(sorted, highQ);
  return arr.map((x) => clamp(x, lo, hi));
}

function computeConservativeFloor(lastValue: number, history: number[], horizon: number) {
  if (history.length < horizon + 6) return Math.max(0, lastValue - 1.0);
  const changes: number[] = [];
  for (let t = horizon; t < history.length; t++) {
    changes.push(history[t] - history[t - horizon]);
  }
  const sorted = changes.slice().sort((a, b) => a - b);
  const q10 = quantile(sorted, 0.1);
  const typicalDrop = Math.abs(Math.min(0, q10));
  const guardedDrop = typicalDrop * 1.15;
  return Math.max(0, lastValue - guardedDrop);
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

type Ar1Fit = { phi: number; c: number; residuals: number[] };

function fitAr1(values: number[], fitWindow: number): Ar1Fit {
  if (values.length < fitWindow + 1) {
    throw new Error(`fitAr1: not enough data (${values.length}) for fitWindow=${fitWindow}`);
  }

  const end = values.length;
  const start = end - fitWindow;
  const x = values.slice(start - 1, end - 1);
  const y = values.slice(start, end);

  const mx = mean(x);
  const my = mean(y);
  const varX = variance(x, mx);

  if (varX === 0) {
    const last = values[values.length - 1];
    return { phi: 0, c: last, residuals: [0] };
  }

  const covXY =
    x.reduce((s, xi, i) => s + (xi - mx) * (y[i] - my), 0) / x.length;
  const phi = clamp(covXY / varX, -0.98, 0.98);
  const c = my - phi * mx;
  const residuals = y.map((yi, i) => yi - (c + phi * x[i]));
  return { phi, c, residuals };
}

type OlsFit = {
  intercept: number;
  beta: number[];
  residuals: number[];
};

function gaussJordanInverse(matrix: number[][]): number[][] {
  const n = matrix.length;
  const a = matrix.map((row) => row.slice());
  const inv = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)),
  );

  for (let i = 0; i < n; i++) {
    let pivot = a[i][i];
    if (Math.abs(pivot) < 1e-12) {
      let swap = i + 1;
      while (swap < n && Math.abs(a[swap][i]) < 1e-12) swap++;
      if (swap === n) throw new Error("Matrix is singular and cannot be inverted.");
      [a[i], a[swap]] = [a[swap], a[i]];
      [inv[i], inv[swap]] = [inv[i], inv[swap]];
      pivot = a[i][i];
    }

    const scale = 1 / pivot;
    for (let j = 0; j < n; j++) {
      a[i][j] *= scale;
      inv[i][j] *= scale;
    }

    for (let k = 0; k < n; k++) {
      if (k === i) continue;
      const factor = a[k][i];
      if (factor === 0) continue;
      for (let j = 0; j < n; j++) {
        a[k][j] -= factor * a[i][j];
        inv[k][j] -= factor * inv[i][j];
      }
    }
  }
  return inv;
}

function olsFitYOnLags(params: {
  y: number[];
  features: number[][];
}): OlsFit {
  const { y, features } = params;
  const n = y.length;
  const nFeatures = features[0]?.length ?? 0;
  if (n < 3) throw new Error("olsFit: not enough data");

  const rows = n - 1;
  const p = 1 + 1 + nFeatures;

  const XTX = Array.from({ length: p }, () => Array.from({ length: p }, () => 0));
  const XTy = Array.from({ length: p }, () => 0);

  for (let t = 1; t < n; t++) {
    const rowVec = [1, y[t - 1], ...features[t - 1]];
    for (let i = 0; i < p; i++) {
      XTy[i] += rowVec[i] * y[t];
      for (let j = 0; j < p; j++) {
        XTX[i][j] += rowVec[i] * rowVec[j];
      }
    }
  }

  const lambda = 1e-6;
  for (let i = 0; i < p; i++) {
    XTX[i][i] += lambda;
  }

  const invXTX = gaussJordanInverse(XTX);
  const betaVec = invXTX.map((row) => row.reduce((s, v, j) => s + v * XTy[j], 0));

  const intercept = betaVec[0];
  const beta = betaVec.slice(1);

  const residuals: number[] = [];
  for (let t = 1; t < n; t++) {
    const yHat =
      intercept + beta[0] * y[t - 1] + beta.slice(1).reduce((s, b, j) => s + b * features[t - 1][j], 0);
    residuals.push(y[t] - yHat);
  }

  return { intercept, beta, residuals };
}

export async function forecastMir1V2(params: {
  target: SeriesPoint[];
  features: FeatureSeriesPoints;
  horizonMonths: ForecastHorizon[];
  fitWindowMonths: number;
  nSimulations?: number;
}): Promise<{
  lastObserved: { period: string; value: number };
  horizons: Mir1V2Forecast["horizons"];
  model: {
    featureKeys: string[];
    ols: {
      intercept: number;
      beta: number[];
    };
    featureAr1: Array<{ phi: number; c: number }>;
  };
  diagnostics: { ar1SigmaApprox: number };
}> {
  const {
    target,
    features,
    horizonMonths,
    fitWindowMonths,
    nSimulations = 800,
  } = params;

  const n = target.length;
  if (n < fitWindowMonths + 2) {
    throw new Error(`Not enough aligned data points: ${n} < fitWindowMonths+2`);
  }

  const lastObserved = target[target.length - 1];
  const lastPeriod = lastObserved.period;
  const y = target.map((p) => p.value);

  const featureKeys = Object.keys(features);
  const nFeatures = featureKeys.length;

  const featureMatrix = target.map((p, idx) => {
    const period = p.period;
    return featureKeys.map((k) => features[k][idx].value);
  });

  const end = n;
  const start = end - fitWindowMonths;
  const yFit = y.slice(start, end);
  const featuresFit = featureMatrix.slice(start, end);

  const ols = olsFitYOnLags({
    y: yFit,
    features: featuresFit,
  });

  const ar1ByFeature: Ar1Fit[] = [];
  const featureBounds: Array<{ min: number; max: number; margin: number }> = [];
  const featureResiduals: number[][] = [];
  for (let j = 0; j < nFeatures; j++) {
    const seriesVals = featureMatrix.slice(start - 1, end).map((row) => row[j]);
    const fit = fitAr1(seriesVals, fitWindowMonths);
    ar1ByFeature.push(fit);
    featureResiduals.push(winsorized(fit.residuals, 0.1, 0.9));
    const featureHist = featureMatrix.slice(start, end).map((row) => row[j]);
    const fMin = Math.min(...featureHist);
    const fMax = Math.max(...featureHist);
    const fMargin = Math.max(0.05, (fMax - fMin) * 0.3);
    featureBounds.push({ min: fMin, max: fMax, margin: fMargin });
  }

  const maxH = Math.max(...horizonMonths);
  const drawsByH: Record<number, number[]> = Object.fromEntries(
    horizonMonths.map((h) => [h, []]),
  ) as Record<number, number[]>;

  let yCurrent = y[n - 1];
  let featureCurrent = featureKeys.map((k) => features[k][n - 1].value);

  const resY = winsorized(ols.residuals, 0.1, 0.9);
  const sigmaApprox = Math.sqrt(
    resY.reduce((s, e) => s + e * e, 0) / Math.max(1, resY.length),
  );
  const yHist = y.slice(start, end);
  const yHistMin = Math.min(...yHist);
  const yHistMax = Math.max(...yHist);
  const yLowerBound = Math.max(0, yHistMin - 0.4);
  const yUpperBound = yHistMax + 1.2;
  const maxStepUp = 0.15;
  const maxStepDown = 0.1;

  for (let sim = 0; sim < nSimulations; sim++) {
    yCurrent = y[n - 1];
    featureCurrent = featureKeys.map((k) => features[k][n - 1].value);

    for (let step = 1; step <= maxH; step++) {
      const eY = sampleFromArray(resY);
      const rawYNext =
        ols.intercept +
        ols.beta[0] * yCurrent +
        ols.beta.slice(1).reduce((s, b, j) => s + b * featureCurrent[j], 0) +
        eY;
      const stepLimitedY = clamp(rawYNext, yCurrent - maxStepDown, yCurrent + maxStepUp);
      const yNext = clamp(stepLimitedY, yLowerBound, yUpperBound);

      const featureNext = featureCurrent.map((fv, j) => {
        const fit = ar1ByFeature[j];
        const eF = sampleFromArray(featureResiduals[j]);
        const raw = fit.c + fit.phi * fv + eF;
        const b = featureBounds[j];
        return clamp(raw, b.min - b.margin, b.max + b.margin);
      });

      yCurrent = yNext;
      featureCurrent = featureNext;

      if (horizonMonths.includes(step as ForecastHorizon)) {
        drawsByH[step].push(yCurrent);
      }
    }
  }

  const horizons: Mir1V2Forecast["horizons"] = horizonMonths
    .slice()
    .sort((a, b) => a - b)
    .map((h) => {
      const arr = drawsByH[h].slice().sort((a, b) => a - b);
      const median = quantile(arr, 0.5);
      const lowRaw = quantile(arr, 0.3);
      const highRaw = quantile(arr, 0.7);
      const floor = computeConservativeFloor(lastObserved.value, yFit, h);
      const low = Math.max(lowRaw, floor);
      const high = Math.max(highRaw, median + 0.05);
      const minHalfBand = 0.04;
      return {
        horizonMonths: h,
        period: addMonthsYYYYMM(lastPeriod, h),
        median,
        low: Math.min(low, median - minHalfBand),
        high: Math.max(high, median + minHalfBand),
      };
    });

  return {
    lastObserved: { period: lastPeriod, value: lastObserved.value },
    horizons,
    model: {
      featureKeys,
      ols: { intercept: ols.intercept, beta: ols.beta },
      featureAr1: ar1ByFeature.map((f) => ({ phi: f.phi, c: f.c })),
    },
    diagnostics: { ar1SigmaApprox: sigmaApprox },
  };
}

export type FeatureSeriesPoints = Record<string, SeriesPoint[]>;

