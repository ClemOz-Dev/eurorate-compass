"use client";

import React, { useEffect, useState } from "react";
import styles from "./DashboardClient.module.css";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type GlossaryEntry = {
  key: string;
  term: string;
  aliases: string[];
  tooltip: string;
  definition: string;
};

const GLOSSARY: GlossaryEntry[] = [
  {
    key: "bce",
    term: "ECB",
    aliases: ["ECB", "BCE"],
    tooltip: "European Central Bank / Banque Centrale Europeenne",
    definition:
      "The European Central Bank sets key policy rates in the euro area. Its decisions influence market rates and, over time, mortgage offers.",
  },
  {
    key: "mir1",
    term: "MIR1",
    aliases: ["MIR1"],
    tooltip: "Monetary and Financial Institutions Interest Rate statistic",
    definition:
      "MIR1 is the family of euro area bank lending rate statistics. Here it proxies the average rate on new French housing loans.",
  },
  {
    key: "pfit",
    term: "PFIT",
    aliases: ["PFIT"],
    tooltip: "Initial rate fixation period",
    definition:
      "PFIT is the initial period during which the interest rate is fixed. In this dashboard, PFIT > 10 years focuses on long initial fixation loans.",
  },
  {
    key: "ar1",
    term: "AR(1)",
    aliases: ["AR(1)"],
    tooltip: "Autoregressive model (order 1)",
    definition:
      "AR(1) means each new value depends on the previous one plus a residual shock. It is used to simulate feature trajectories month by month.",
  },
  {
    key: "ols",
    term: "OLS",
    aliases: ["OLS"],
    tooltip: "Ordinary Least Squares regression",
    definition:
      "OLS is a linear regression method. Here it combines the lagged target and lagged macro drivers to estimate the next period mortgage rate.",
  },
  {
    key: "hicp",
    term: "HICP",
    aliases: ["HICP"],
    tooltip: "Harmonised Index of Consumer Prices (inflation)",
    definition:
      "HICP is the euro area's standard inflation measure. Persistent inflation pressure can keep policy rates and long borrowing costs elevated.",
  },
  {
    key: "ciss",
    term: "CISS",
    aliases: ["CISS"],
    tooltip: "Composite Indicator of Systemic Stress",
    definition:
      "CISS tracks financial stress. Rising stress can increase risk premia and create volatility in long-term rates.",
  },
  {
    key: "pp",
    term: "pp",
    aliases: ["pp", "percentage points"],
    tooltip: "Percentage points (difference between percentages)",
    definition:
      "A change in percentage points compares two rates directly (e.g., 3.5% to 4.0% = +0.5 pp). This is not the same as +14.3% relative change.",
  },
  {
    key: "median",
    term: "median",
    aliases: ["median"],
    tooltip: "Middle forecast value",
    definition:
      "The median is the middle simulated value: 50% of simulations are below and 50% are above.",
  },
];

function escapeRegex(input: string) {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function glossaryRegex() {
  const aliases = GLOSSARY.flatMap((g) => g.aliases).sort((a, b) => b.length - a.length);
  return new RegExp(`\\b(${aliases.map(escapeRegex).join("|")})\\b`, "gi");
}

function findGlossaryEntry(token: string) {
  const lowered = token.toLowerCase();
  return GLOSSARY.find((g) => g.aliases.some((a) => a.toLowerCase() === lowered));
}

type DashboardResponse = {
  ok: true;
  asOf: string;
  forecast: {
    lastObserved: { period: string; value: number };
    forecasts: Record<
      number,
      { period: string; median: number; low: number; high: number }
    >;
  };
  drivers?: Array<{
    key: string;
    label: string;
    current: number | null;
    currentPeriod?: string | null;
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

export default function DashboardClient() {
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [focusHorizon, setFocusHorizon] = useState<12 | 24 | 36>(36);
  const [mounted, setMounted] = useState(false);
  const [activeGlossary, setActiveGlossary] = useState<GlossaryEntry | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/dashboard");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as DashboardResponse;
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    setMounted(true);
  }, []);

  const chartData =
    data == null
      ? []
      : Object.entries(data.forecast.forecasts)
          .map(([h, v]) => ({
            horizonMonths: Number(h),
            period: v.period,
            low: v.low,
            median: v.median,
            high: v.high,
          }))
          .sort((a, b) => a.horizonMonths - b.horizonMonths);

  const focused = chartData.find((x) => x.horizonMonths === focusHorizon);
  const chartDataForFocus = chartData.filter((x) => x.horizonMonths <= focusHorizon);

  function confidenceFromSpread(spread: number, horizonMonths: number, median: number) {
    const relative = spread / Math.max(0.5, Math.abs(median));
    const adjusted = relative * Math.sqrt(Math.max(1, horizonMonths / 12));
    if (adjusted <= 0.22) {
      return { label: "high confidence", cls: styles.confidenceHigh, score: adjusted };
    }
    if (adjusted <= 0.38) {
      return { label: "medium confidence", cls: styles.confidenceMedium, score: adjusted };
    }
    return { label: "low confidence", cls: styles.confidenceLow, score: adjusted };
  }

  function directionBadge(v: number | null) {
    if (v == null) return { txt: "n/a", cls: styles.badgeNeutral };
    if (v > 0.05) return { txt: "up", cls: styles.badgeUp };
    if (v < -0.05) return { txt: "down", cls: styles.badgeDown };
    return { txt: "stable", cls: styles.badgeNeutral };
  }

  function impactOnMir1(driverKey: string, delta3m: number | null) {
    if (delta3m == null) return { txt: "n/a", cls: styles.badgeNeutral };
    const positivePressureKeys = new Set([
      "depositFacility",
      "mainRefi",
      "marginalLending",
      "tenYYield",
      "hicpHeadline",
      "hicpEnergy",
      "ciss",
    ]);
    const negativePressureKeys = new Set(["unemployment"]);

    const eps = 0.05;
    if (Math.abs(delta3m) < eps) return { txt: "mixed / neutral", cls: styles.badgeNeutral };

    if (positivePressureKeys.has(driverKey)) {
      return delta3m > 0
        ? { txt: "upward pressure", cls: styles.badgeUp }
        : { txt: "downward pressure", cls: styles.badgeDown };
    }

    if (negativePressureKeys.has(driverKey)) {
      return delta3m > 0
        ? { txt: "downward pressure", cls: styles.badgeDown }
        : { txt: "upward pressure", cls: styles.badgeUp };
    }

    return { txt: "mixed / neutral", cls: styles.badgeNeutral };
  }

  const focusedConfidence = focused
    ? confidenceFromSpread(focused.high - focused.low, focused.horizonMonths, focused.median)
    : null;

  function renderGlossaryText(text: string) {
    const regex = glossaryRegex();
    const chunks: React.ReactNode[] = [];
    let lastIndex = 0;
    let idx = 0;
    for (const match of text.matchAll(regex)) {
      const full = match[0];
      const start = match.index ?? 0;
      if (start > lastIndex) chunks.push(text.slice(lastIndex, start));
      const entry = findGlossaryEntry(full);
      if (entry) {
        chunks.push(
          <span
            key={`${entry.key}-${start}-${idx}`}
            className={styles.glossaryTerm}
            title={entry.tooltip}
            onClick={() => setActiveGlossary(entry)}
          >
            {full}
          </span>,
        );
      } else {
        chunks.push(full);
      }
      lastIndex = start + full.length;
      idx += 1;
    }
    if (lastIndex < text.length) chunks.push(text.slice(lastIndex));
    return chunks;
  }

  return (
    <section className={styles.section}>
      <div className={styles.toolbar}>
        <button
          onClick={load}
          disabled={loading}
          className={styles.refreshButton}
        >
          {loading ? "Loading..." : "Refresh forecast"}
        </button>
        <span className={styles.asOf}>
          {data ? `As of ${new Date(data.asOf).toLocaleString("fr-FR")}` : ""}
        </span>
        {mounted ? (
          <label className={styles.horizonControl}>
            Focus horizon:&nbsp;
            <select
              value={focusHorizon}
              onChange={(e) => setFocusHorizon(Number(e.target.value) as 12 | 24 | 36)}
              className={styles.select}
            >
              <option value={12}>12 months</option>
              <option value={24}>24 months</option>
              <option value={36}>36 months</option>
            </select>
          </label>
        ) : (
          <span className={styles.horizonControl} />
        )}
      </div>

      {error ? (
        <pre className={styles.error}>{error}</pre>
      ) : null}

      {data ? (
        <>
          <div className={styles.card}>
            <h2 className={styles.cardTitle}>
              Forecast (<span className={styles.glossaryTerm} title="Initial rate fixation period">PFIT</span>{" "}
              {">"} 10y)
            </h2>
            <div className={styles.chartWrap}>
              <ResponsiveContainer>
              <AreaChart data={chartDataForFocus}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="period" />
                <YAxis />
                <Tooltip
                  formatter={(value: any) => `${Number(value).toFixed(2)}%`}
                />
                <Area
                  type="monotone"
                  dataKey="high"
                  stroke="#4f46e5"
                  fill="#4f46e5"
                  fillOpacity={0.08}
                  name="High"
                />
                <Area
                  type="monotone"
                  dataKey="low"
                  stroke="#4f46e5"
                  fill="#4f46e5"
                  fillOpacity={0.08}
                  name="Low"
                />
                <Area
                  type="monotone"
                  dataKey="median"
                  stroke="#111827"
                  fill="transparent"
                  name="Median"
                  dot={{ r: 3 }}
                />
              </AreaChart>
              </ResponsiveContainer>
            </div>

          {focused ? (
            <div className={styles.focusCard}>
              <strong>{focusHorizon}m focus:</strong> {focused.period} · median{" "}
              {focused.median.toFixed(2)}% · range [{focused.low.toFixed(2)}%;{" "}
              {focused.high.toFixed(2)}%]
              <span
                className={`${styles.confidenceChip} ${focusedConfidence?.cls ?? ""}`}
              >
                {focusedConfidence?.label}{" "}
                {focusedConfidence ? `(${focusedConfidence.score.toFixed(2)})` : ""}
              </span>
            </div>
          ) : null}

            <div className={styles.horizonList}>
            {chartData.map((row) => {
              const confidence = confidenceFromSpread(
                row.high - row.low,
                row.horizonMonths,
                row.median,
              );
              return (
              <div key={row.horizonMonths} className={styles.horizonItem}>
                <span>
                  Horizon +{row.horizonMonths} months
                </span>
                  <span className={styles.strong}>
                  {row.period} · {renderGlossaryText("median")} {row.median.toFixed(2)}%
                </span>
                  <span className={styles.muted}>
                  [{row.low.toFixed(2)}%; {row.high.toFixed(2)}%]
                </span>
                  <span
                    className={`${styles.confidenceChip} ${confidence.cls}`}
                  >
                    {confidence.label} ({confidence.score.toFixed(2)})
                  </span>
              </div>
              );
            })}
            </div>
          </div>

          <div className={styles.driversCard}>
            <div className={styles.driversHeader}>
              <span>Indicator</span>
              <span>Current (period)</span>
              <span>3m change (pp)</span>
              <span>12m change (pp)</span>
              <span>Trend</span>
              <span>Impact on {renderGlossaryText("MIR1")}</span>
            </div>
            {(data.drivers ?? []).map((d) => {
              const badge = directionBadge(d.change3m_pp);
              const impact = impactOnMir1(d.key, d.change3m_pp);
              return (
                  <div key={d.key} className={styles.driversRow}>
                  <span className={styles.strong}>{renderGlossaryText(d.label)}</span>
                  <span>
                    {d.current == null
                      ? "n/a"
                      : `${d.current.toFixed(2)}${d.currentPeriod ? ` (${d.currentPeriod})` : ""}`}
                  </span>
                  <span>{d.change3m_pp == null ? "n/a" : d.change3m_pp.toFixed(2)}</span>
                  <span>{d.change12m_pp == null ? "n/a" : d.change12m_pp.toFixed(2)}</span>
                    <span className={badge.cls}>{badge.txt}</span>
                    <span className={impact.cls}>{renderGlossaryText(impact.txt)}</span>
                </div>
              );
            })}
          </div>

          <article className={styles.synthesisCard}>
            <h2 className={styles.cardTitle}>Market Brief</h2>
            <h3 className={styles.synthesisTitle}>{renderGlossaryText(data.synthesis.title)}</h3>
            <p className={styles.summary}>
              {renderGlossaryText(data.synthesis.summary)}
            </p>

            {data.synthesis.actus.length > 0 ? (
              <div>
                <div className={styles.subTitle}>Key points</div>
                <ul className={styles.list}>
                  {data.synthesis.actus.map((x, idx) => (
                    <li key={idx} className={styles.listItem}>
                      {renderGlossaryText(x)}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {data.synthesis.riskFlags.length > 0 ? (
              <div>
                <div className={styles.subTitle}>Risk flags</div>
                <ul className={styles.list}>
                  {data.synthesis.riskFlags.map((rf, idx) => (
                    <li key={idx} className={styles.listItem}>
                      <span className={styles.riskSymbol}>{rf.direction}</span>{" "}
                      {renderGlossaryText(rf.label)} —{" "}
                      <span className={styles.muted}>{renderGlossaryText(rf.explanation)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </article>

          <article className={styles.glossaryCard}>
            <h2 className={styles.cardTitle}>Glossary (technical terms)</h2>
            <p className={styles.glossaryHint}>
              Hover to get a quick translation. Click a term to open a full definition.
            </p>
            <ul className={styles.glossaryList}>
              {GLOSSARY.map((entry) => (
                <li key={entry.key}>
                  <span
                    className={styles.glossaryTerm}
                    title={entry.tooltip}
                    onClick={() => setActiveGlossary(entry)}
                  >
                    {entry.term}
                  </span>{" "}
                  - {entry.tooltip}
                </li>
              ))}
            </ul>
          </article>

          {activeGlossary ? (
            <div className={styles.modalOverlay} onClick={() => setActiveGlossary(null)}>
              <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
                <div className={styles.modalHeader}>
                  <h3 className={styles.modalTitle}>{activeGlossary.term}</h3>
                  <button
                    className={styles.closeButton}
                    onClick={() => setActiveGlossary(null)}
                    type="button"
                  >
                    Close
                  </button>
                </div>
                <p className={styles.modalIntro}>{activeGlossary.tooltip}</p>
                <div className={styles.modalBody}>{activeGlossary.definition}</div>
              </div>
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

