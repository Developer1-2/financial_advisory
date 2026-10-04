require('dotenv').config();
const express = require('express');
const axios = require('axios');
const app = express();

const PORT = process.env.PORT || 3000;

// Key must live in .env as FINNHUB_API_KEY (never hardcode it in this file)
const API_KEY = process.env.FINNHUB_KEY;
if (!API_KEY) {
    console.log(API_KEY);
    console.error('❌ FINNHUB_API_KEY is missing. Add it to your .env file and restart.');
    process.exit(1);
}

const FINNHUB_NEWS_URL = 'https://finnhub.io/api/v1/news';
const VALID_CATEGORIES = ['general', 'forex', 'crypto', 'merger'];
const MAX_ARTICLES = 20;

// Cache is kept per category
const newsCache = {};
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes (free tier allows ~60 calls/min)

app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', process.env.ALLOWED_ORIGIN || '*');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    next();
});

app.get('/api/financial-news', async (req, res) => {
    const category = (req.query.category || 'general').toLowerCase();

    if (!VALID_CATEGORIES.includes(category)) {
        return res.status(400).json({
            error: `Invalid category. Use one of: ${VALID_CATEGORIES.join(', ')}`
        });
    }

    const now = Date.now();
    const cached = newsCache[category];

    if (cached && now - cached.lastFetched < CACHE_DURATION) {
        return res.json({ source: 'cache', category, articles: cached.data });
    }

    try {
        const response = await axios.get(FINNHUB_NEWS_URL, {
            headers: {
                'Accept': 'application/json',
                'X-Finnhub-Token': API_KEY
            },
            params: { category },
            timeout: 10000
        });

        // Finnhub returns a plain JSON array on success
        if (!Array.isArray(response.data)) {
            throw new Error(response.data?.error || 'Unexpected response from Finnhub (expected an array).');
        }

        const cleanArticles = response.data.slice(0, MAX_ARTICLES).map(item => ({
            id: item.id,
            title: item.headline,
            summary: item.summary,
            url: item.url,
            timePublished: new Date(item.datetime * 1000).toISOString(), // Finnhub sends Unix seconds
            source: item.source,
            bannerImage: item.image || null,
            category: item.category,
            related: item.related
        }));

        newsCache[category] = { data: cleanArticles, lastFetched: now };

        return res.json({ source: 'live_api', category, articles: cleanArticles });

    } catch (error) {
        const status = error.response?.status;
        let message = error.response?.data?.error || error.message;

        if (status === 401 || status === 403) message = 'Finnhub rejected the API key.';
        if (status === 429) message = 'Finnhub rate limit reached. Try again shortly.';

        console.error(`❌ Error retrieving financial news (${category}):`, message);

        if (cached) {
            return res.status(200).json({ source: 'stale_cache_fallback', category, articles: cached.data });
        }
        res.status(500).json({ error: message });
    }
});

// ---------- Stock ticker quotes ----------
// Free Finnhub keys cover US stocks and ETFs, so the three index slots use ETFs that track them.
const TICKER_SYMBOLS = [
    { symbol: 'SPY', name: 'S&P 500 ETF' },
    { symbol: 'QQQ', name: 'Nasdaq 100 ETF' },
    { symbol: 'DIA', name: 'Dow Jones ETF' },
    { symbol: 'AAPL', name: 'Apple' },
    { symbol: 'MSFT', name: 'Microsoft' },
    { symbol: 'NVDA', name: 'Nvidia' },
    { symbol: 'AMZN', name: 'Amazon' },
    { symbol: 'GOOGL', name: 'Alphabet' },
    { symbol: 'META', name: 'Meta' },
    { symbol: 'TSLA', name: 'Tesla' }
];
const QUOTE_CACHE_DURATION = 60 * 1000; // 1 minute: 10 calls/min, well inside the 60/min free limit
let quoteCache = { data: null, lastFetched: 0 };

app.get('/api/quotes', async (req, res) => {
    const now = Date.now();

    if (quoteCache.data && now - quoteCache.lastFetched < QUOTE_CACHE_DURATION) {
        return res.json({ source: 'cache', quotes: quoteCache.data });
    }

    try {
        const results = await Promise.allSettled(TICKER_SYMBOLS.map(async ({ symbol, name }) => {
            const response = await axios.get('https://finnhub.io/api/v1/quote', {
                headers: { 'X-Finnhub-Token': API_KEY },
                params: { symbol },
                timeout: 8000
            });
            const q = response.data;
            if (!q || !q.c) throw new Error(`No data for ${symbol}`); // c = 0 means unknown symbol
            return {
                symbol,
                name,
                price: q.c,
                change: q.d ?? 0,
                changePercent: q.dp ?? 0,
                timestamp: q.t
            };
        }));

        const quotes = results.filter(r => r.status === 'fulfilled').map(r => r.value);
        if (!quotes.length) throw new Error('No quotes available from Finnhub.');

        quoteCache = { data: quotes, lastFetched: now };
        return res.json({ source: 'live_api', quotes });

    } catch (error) {
        console.error('❌ Error retrieving quotes:', error.message);
        if (quoteCache.data) {
            return res.status(200).json({ source: 'stale_cache_fallback', quotes: quoteCache.data });
        }
        res.status(500).json({ error: error.message });
    }
});

app.listen(PORT, () => {
    console.log(`Financial news proxy backend running on http://localhost:${PORT}`);
});
