const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());

// Cache in memoria per 3 minuti per evitare blocchi e rate limit (429)
const cache = {};
const CACHE_DURATION_MS = 3 * 60 * 1000;

app.get('/price', async (req, res) => {
  const rawSymbols = req.query.symbols || req.query.symbol;

  if (!rawSymbols) {
    return res.status(400).json({ error: 'Parametro "symbol" o "symbols" mancante.' });
  }

  // Pulisce e crea una lista di ticker unici
  const symbolList = Array.from(
    new Set(rawSymbols.split(',').map(s => s.trim().toUpperCase()).filter(Boolean))
  );

  const now = Date.now();
  const results = {};
  const missingSymbols = [];

  // Controlla la cache locale
  symbolList.forEach(sym => {
    if (cache[sym] && (now - cache[sym].timestamp < CACHE_DURATION_MS)) {
      results[sym] = cache[sym].data;
    } else {
      missingSymbols.push(sym);
    }
  });

  // Se abbiamo già tutto in cache, restituisce subito i dati
  if (missingSymbols.length === 0) {
    return sendResponse(res, results, symbolList, req.query.symbol);
  }

  try {
    // Interroga Yahoo Finance in un'unica chiamata batch
    const yahooUrl = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(missingSymbols.join(','))}`;
    
    const response = await axios.get(yahooUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
      },
      timeout: 8000
    });

    const quoteResults = response.data?.quoteResponse?.result || [];

    quoteResults.forEach(quote => {
      const sym = quote.symbol.toUpperCase();
      const itemData = {
        symbol: sym,
        price: quote.regularMarketPrice ?? 0,
        currency: quote.currency || 'EUR',
        changePercent: quote.regularMarketChangePercent ?? 0,
        longName: quote.longName || quote.shortName || sym
      };

      cache[sym] = { data: itemData, timestamp: now };
      results[sym] = itemData;
    });

    return sendResponse(res, results, symbolList, req.query.symbol);

  } catch (error) {
    console.error('Errore chiamata Yahoo:', error.message);
    
    // Fallback sulla cache in caso di errore di rete o rate limit
    const fallbackResults = {};
    symbolList.forEach(sym => {
      if (cache[sym]) fallbackResults[sym] = cache[sym].data;
    });

    if (Object.keys(fallbackResults).length > 0) {
      return sendResponse(res, fallbackResults, symbolList, req.query.symbol);
    }

    return res.status(500).json({ error: 'Errore durante la chiamata a Yahoo Finance', details: error.message });
  }
});

function sendResponse(res, resultsMap, requestedSymbols, isSingleQuery) {
  if (isSingleQuery && requestedSymbols.length === 1) {
    const singleData = resultsMap[requestedSymbols[0]];
    if (!singleData) {
      return res.status(404).json({ error: `Simbolo ${requestedSymbols[0]} non trovato.` });
    }
    return res.json(singleData);
  }

  return res.json({
    count: Object.keys(resultsMap).length,
    results: Object.values(resultsMap)
  });
}

app.listen(PORT, () => {
  console.log(`Proxy attivo sulla porta ${PORT}`);
});
