const express = require('express');
const axios = require('axios');
const app = express();
const port = 3000;

let coinList = [];
const cache = {};

async function fetchCoinList() {
    try {
        const response = await axios.get('https://api.coingecko.com/api/v3/coins/list');
        coinList = response.data;
        console.log('Coin list fetched with', coinList.length, 'coins');
        if (coinList.length === 0) throw new Error('Empty coin list');
    } catch (error) {
        console.error('Error fetching coin list:', error.message);
        console.log('Retrying in 5 seconds...');
        await new Promise(resolve => setTimeout(resolve, 5000));
        await fetchCoinList();
    }
}
fetchCoinList();

app.use(express.static('public'));

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

app.get('/api/analyze/:coin', async (req, res) => {
    const userInput = req.params.coin.toLowerCase();
    const coin = coinList.find(c => c.name.toLowerCase() === userInput || c.symbol.toLowerCase() === userInput);

    console.log('User Input:', userInput);
    console.log('Matched Coin:', coin);

    if (!coin) {
        return res.json({ error: 'Cryptocurrency not found' });
    }

    const now = Date.now();
    const cacheEntry = cache[coin.id];
    const cacheTTL = 5 * 60 * 1000; // 5 minutes

    if (cacheEntry && (now - cacheEntry.timestamp) < cacheTTL) {
        console.log(`Using cached data for ${coin.id}`);
        return res.json(cacheEntry.data);
    }

    try {
        await delay(1000);
        const ohlcResponse = await axios.get(`https://api.coingecko.com/api/v3/coins/${coin.id}/ohlc?vs_currency=usd&days=30`);
        const ohlcData = ohlcResponse.data;
        console.log(`OHLC Data for ${coin.id}:`, ohlcData.length);

        if (ohlcData.length < 5) {
            console.log(`Not enough data for ${coin.id}: ${ohlcData.length} entries`);
            return res.json({ error: 'Not enough data for analysis' });
        }

        const priceResponse = await axios.get(`https://api.coingecko.com/api/v3/simple/price?ids=${coin.id}&vs_currencies=usd`);
        const currentPrice = priceResponse.data[coin.id].usd;
        console.log(`Price for ${coin.id}:`, currentPrice);

        const lows = ohlcData.map(d => d[3]);
        const highs = ohlcData.map(d => d[2]);
        const support = Math.min(...lows);
        const resistance = Math.max(...highs);

        const trueRanges = [];
        for (let i = 1; i < ohlcData.length; i++) {
            const high = ohlcData[i][2];
            const low = ohlcData[i][3];
            const prevClose = ohlcData[i - 1][4];
            const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
            trueRanges.push(tr);
        }
        const atr = trueRanges.slice(-14).reduce((sum, tr) => sum + tr, 0) / 14 || 0; // Default to 0 if NaN

        const entry = support;
        const exit = resistance;
        const stopLoss = support - atr;
        const takeProfit1 = resistance;
        const takeProfit2 = resistance + atr;

        // In-depth analysis
        const priceToSupport = ((currentPrice - support) / support) * 100; // % from support
        const priceToResistance = ((resistance - currentPrice) / resistance) * 100; // % from resistance
        const potentialGain = ((takeProfit1 - entry) / entry) * 100; // % gain from entry to TP1
        let inDepthAnalysis = `${coin.name} is currently priced at $${currentPrice.toFixed(2)}, which sits between its 30-day support level of $${support.toFixed(2)} and resistance level of $${resistance.toFixed(2)}. `;
        inDepthAnalysis += `This positioning suggests that the price is in a ${priceToSupport < 10 ? 'potential support zone' : priceToResistance < 10 ? 'potential resistance zone' : 'consolidation phase'}, potentially preparing for a move toward either the support or resistance. `;
        inDepthAnalysis += `The ATR (Average True Range) of $${atr.toFixed(2)} indicates ${atr === 0 ? 'extremely low or no recorded volatility (possible data issue)' : atr < currentPrice * 0.02 ? 'low volatility' : 'high volatility'} over the past 14 days, meaning price movements could be ${atr === 0 || atr < currentPrice * 0.02 ? 'gradual' : 'more significant'}. `;
        inDepthAnalysis += `A suggested entry point near $${entry.toFixed(2)} aligns with buying at support, offering a low-risk opportunity if the price holds this level. `;
        inDepthAnalysis += `The stop loss at $${stopLoss.toFixed(2)} is ${stopLoss === support ? 'tight, matching the support' : 'set below support'}, meaning any break below could signal a bearish shift—be cautious here. `;
        inDepthAnalysis += `The take profit levels at $${takeProfit1.toFixed(2)} (both Level 1 and Level 2) target the recent resistance, implying a potential ${potentialGain.toFixed(0)}% gain from the entry if reached, though the identical levels suggest limited upside momentum beyond this point based on the 30-day data. `;
        inDepthAnalysis += `Traders might watch for a breakout above $${resistance.toFixed(2)} with increased volume to confirm further upside, or a drop below $${support.toFixed(2)} to exit quickly due to the ${atr === 0 || atr < currentPrice * 0.02 ? 'low volatility environment' : 'volatile conditions'}.`;

        const result = {
            current_price: currentPrice.toFixed(2),
            entry: entry.toFixed(2),
            exit: exit.toFixed(2),
            stop_loss: stopLoss.toFixed(2),
            take_profit_1: takeProfit1.toFixed(2),
            take_profit_2: takeProfit2.toFixed(2),
            atr: atr.toFixed(2),
            in_depth_analysis: inDepthAnalysis
        };

        cache[coin.id] = { data: result, timestamp: now };
        res.json(result);
    } catch (error) {
        console.error(`Error fetching data for ${coin.id}:`, {
            message: error.message,
            status: error.response ? error.response.status : 'No response',
            data: error.response ? error.response.data : 'No data'
        });
        res.json({ error: 'Error fetching data from CoinGecko' });
    }
});

app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});