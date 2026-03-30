export type DbnomicsPeriodValue = { period: string; value: number };

type DbnomicsSeriesResponse = {
  series: {
    docs: Array<{
      period: string[];
      value: number[];
    }>;
  };
};

const DBNOMICS_BASE_URL = "https://api.db.nomics.world/v22";

export async function fetchDbnomicsSeriesWithObservations(params: {
  provider: string;
  dataset: string;
  series: string;
}): Promise<DbnomicsPeriodValue[]> {
  const url = new URL(
    `${DBNOMICS_BASE_URL}/series/${encodeURIComponent(params.provider)}/${encodeURIComponent(
      params.dataset,
    )}/${encodeURIComponent(params.series)}`,
  );
  url.searchParams.set("observations", "true");

  const res = await fetch(url.toString(), {
    method: "GET",
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error(`DBnomics fetch failed: ${res.status} ${res.statusText}`);
  }

  const data = (await res.json()) as DbnomicsSeriesResponse;
  const doc = data?.series?.docs?.[0];
  if (!doc?.period || !doc?.value || doc.period.length !== doc.value.length) {
    throw new Error("DBnomics response format unexpected (period/value mismatch)");
  }

  return doc.period.map((p, i) => ({ period: p, value: doc.value[i] }));
}

