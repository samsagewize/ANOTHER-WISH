const UNISAT_BASE = 'https://open-api.unisat.io';

async function getJson(path: string, apiKey: string) {
  const response = await fetch(`${UNISAT_BASE}${path}`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: 'application/json',
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body?.code) {
    throw new Error(body?.msg || `UniSat request failed with ${response.status}`);
  }
  return body?.data ?? body;
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const tickerParam = Array.isArray(req.query.ticker) ? req.query.ticker[0] : req.query.ticker;
  const ticker = String(tickerParam || '').trim().toLowerCase();
  if (!/^[a-z0-9]{4}$/.test(ticker)) {
    res.status(400).json({ error: 'BRC-20 ticker must be exactly 4 letters or numbers.' });
    return;
  }

  const apiKey = process.env.UNISAT_API_KEY;
  if (!apiKey) {
    res.status(503).json({
      error: 'UNISAT_API_KEY is not configured yet.',
      ticker,
      setupNeeded: true,
      source: 'UniSat Open API',
      endpoints: [
        `/v1/indexer/brc20/${ticker}/info`,
        `/v1/indexer/brc20/${ticker}/holders?start=0&limit=8`,
      ],
    });
    return;
  }

  try {
    const [info, holders] = await Promise.all([
      getJson(`/v1/indexer/brc20/${encodeURIComponent(ticker)}/info`, apiKey),
      getJson(`/v1/indexer/brc20/${encodeURIComponent(ticker)}/holders?start=0&limit=8`, apiKey),
    ]);

    res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=120');
    res.status(200).json({
      ticker,
      info,
      holders: Array.isArray(holders?.detail) ? holders.detail : Array.isArray(holders) ? holders : [],
      source: 'UniSat Open API',
      endpoints: [
        `/v1/indexer/brc20/${ticker}/info`,
        `/v1/indexer/brc20/${ticker}/holders?start=0&limit=8`,
      ],
    });
  } catch (err: any) {
    res.status(502).json({ error: err.message || 'Unable to load BRC-20 data from UniSat.', ticker });
  }
}
