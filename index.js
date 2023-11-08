const express = require("express");
const Alpaca = require("@alpacahq/alpaca-trade-api");
const {
  getWeeklyRSI,
  get50SMA,
  get200SMA,
  compileStockData,
  getLatestStockPrice,
  canBuyStock,
  getAllAccountInfo,
} = require("./utils");
const { sendEmail } = require("./email");
const Twilio = require("twilio");
require("dotenv").config();
const client = new Twilio(
  "ACc375e9f7821e39c0b856165a298b1fe8",
  process.env.TWILIO_AUTH_TOKEN
);

const app = express();
const port = process.env.PORT || 3040;

const alpaca = new Alpaca({
  keyId: process.env.ALPACA_KEY_ID,
  secretKey: process.env.ALPACA_SECRET_KEY,
  paper: true, // Set to 'false' for live trading
  usePolygon: false, // Set to 'true' if you want to use Polygon.io data
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});

// ============================================================

// Define an endpoint to fetch RSI data
app.get("/doWork", async (req, res) => {
  try {
    let response = await getAllAccountInfo({});

    if (ableToBuy(response)) {
      response = await lookForAndMaybeBuyStock(response);
    } else if (ableToSell(response)) {
      response = await maybeSellStock(response);
    }

    if (response.soldStock) {
      await sleep(10000);
      response = await getAllAccountInfo(response);
      if (ableToBuy(response)) {
        response = await lookForAndMaybeBuyStock(response);
      }
    }

    res.json(response);
  } catch (error) {
    client.messages.create({
      from: "+18135925206",
      body: `Something went wrong with the stock trading bot.`,
      to: process.env.MY_NUMBER,
    });
    console.error("Error:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

async function maybeSellStock(response) {
  const symbols = [response.positionInfo[0].symbol];
  let allStockData = await getStockInfo(symbols);
  response.stockToSellData = allStockData;

  response.soldStock = false;
  if (shouldSellStock(response)) {
    // if (true) {
    response = await sellStock(response);
    response.soldStock = true;
    await getOrdersInfo().then((orderInfo) => {
      response.orderInfo = orderInfo;
    });
  } else {
    console.log("Shouldn't sell stock yet.");
  }

  return response;
}

async function sellStock(data) {
  await alpaca.createOrder({
    symbol: data.positionInfo[0].symbol,
    qty: data.positionInfo[0].qty,
    side: "sell",
    type: "market",
    time_in_force: "day",
  });
  console.log(
    `Selling ${data.positionInfo[0].qty} shares of ${data.positionInfo[0].symbol}! Portfolio value: ${data.accountInfo.portfolio_value}`
  );
  const toEmail = process.env.TO_EMAIL || "default@gmail.com";
  await sendEmail(
    toEmail,
    `Selling ${data.positionInfo[0].qty} shares of ${data.positionInfo[0].symbol}! Portfolio value: ${data.accountInfo.portfolio_value}`,
    `Selling ${data.positionInfo[0].qty} shares of ${data.positionInfo[0].symbol}! Portfolio value: ${data.accountInfo.portfolio_value}`,
    "<b>Hello world?</b>"
  );
  return data;
}

function shouldSellStock(data) {
  return (
    stockPriceIsLessThan95PercentOf200SMA(data) ||
    (stockPriceIsMoreThan15PercentOver200SMA &&
      data.stockToSellData.latestRSI > 60)
  );
}

function stockPriceIsMoreThan15PercentOver200SMA(data) {
  return (
    data.stockToSellData.latestStockPrice >
    1.15 * data.stockToSellData.latestSMA200
  );
}

function stockPriceIsLessThan95PercentOf200SMA(data) {
  return (
    data.stockToSellData.latestStockPrice <
    0.95 * data.stockToSellData.latestSMA200
  );
}

function ableToSell(data) {
  return currentlyHaveAStock(data) && !data.orderInfo.length;
}

function currentlyHaveAStock(data) {
  return data.positionInfo.length;
}

async function lookForAndMaybeBuyStock(response) {
  const symbols = [
    "AAPL",
    "TSLA",
    "AMZN",
    "NVDA",
    "META",
    "MSFT",
    "GOOG",
    "NFLX",
    "ORCL",
    "ATI",
    "WSC",
    "ARCO",
    "SAP",
    "WFRD",
    "MNST",
  ];

  let allStockData = await getStockInfo(symbols);
  response.stockData = allStockData;

  //stocktobuy is null if no stocks to buy
  response.stockToBuy = getStockToBuy(response.stockData);

  if (readyToBuyStock(response)) {
    let numSharesToBuy = Math.floor(
      (0.9 * response.accountInfo.non_marginable_buying_power) /
        response.stockToBuy.latestStockPrice
    );
    await alpaca.createOrder({
      symbol: response.stockToBuy.symbol,
      qty: numSharesToBuy,
      side: "buy",
      type: "market",
      time_in_force: "day",
    });
    console.log(
      `Buying ${numSharesToBuy} shares of ${response.stockToBuy.symbol}! Portfolio value: ${response.accountInfo.portfolio_value}`
    );
    const toEmail = process.env.TO_EMAIL || "default@gmail.com";
    await sendEmail(
      toEmail,
      `Buying ${numSharesToBuy} shares of ${response.stockToBuy.symbol}! Portfolio value: ${response.accountInfo.portfolio_value}`,
      `Buying ${numSharesToBuy} shares of ${response.stockToBuy.symbol}! Portfolio value: ${response.accountInfo.portfolio_value}`,
      "<b>Hello world?</b>"
    );

    await getOrdersInfo().then((orderInfo) => {
      response.orderInfo = orderInfo;
    });
  }
  return response;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getStockInfo(symbols) {
  let allStockData = [];

  for (let symbol of symbols) {
    // need to sleep for a minute between each stock once have free version of alpha vantage, get 5 api calls per minute and each of these calls the api 4 times.
    await sleep(61000);

    const weeklyRSI = await getWeeklyRSI(symbol);
    const SMA50 = await get50SMA(symbol);
    const SMA200 = await get200SMA(symbol);

    const stockData = compileStockData(
      symbol,
      SMA50.data["Technical Analysis: SMA"],
      SMA200.data["Technical Analysis: SMA"],
      weeklyRSI
    );

    let latestStockPrice = await getLatestStockPrice(symbol);
    stockData.latestStockPrice = latestStockPrice;

    stockData.latestRSI = Number(stockData.latestRSI);
    stockData.latestStockPrice = Number(stockData.latestStockPrice);
    let stockPriceOver200SMAByLessThan7Percent =
      stockData.latestStockPrice > stockData.latestSMA200 &&
      stockData.latestStockPrice < stockData.latestSMA200 * 1.07;

    stockData.stockPriceOver200SMAByLessThan7Percent =
      stockPriceOver200SMAByLessThan7Percent;
    let canBuyStock1 = canBuyStock(stockData);
    stockData.canBuyStock = canBuyStock1;
    allStockData.push(stockData);
  }
  allStockData.push;
  return allStockData;
}

function readyToBuyStock(data) {
  return (
    data.stockToBuy !== null &&
    !data.positionInfo.length &&
    !data.orderInfo.length
  );
}

function ableToBuy(data) {
  return !data.positionInfo.length && !data.orderInfo.length;
}

async function getOrdersInfo() {
  try {
    let orders = await alpaca.getOrders();
    return orders;
  } catch (error) {
    console.error("Error fetching position information:", error);
    throw error; // You can choose to handle the error as needed
  }
}

function getStockToBuy(stockData) {
  // Filter the stockData array to only include objects with "canBuyStock" set to true
  const buyableStocks = stockData.filter((stock) => stock.canBuyStock);

  // Check if there are any buyable stocks
  if (buyableStocks.length === 0) {
    return null; // No buyable stocks found
  }

  // Use reduce to find the object with the lowest "latestRSI" value
  const lowestRSIStock = buyableStocks.reduce((minRSIStock, currentStock) => {
    if (!minRSIStock || currentStock.latestRSI < minRSIStock.latestRSI) {
      return currentStock;
    }
    return minRSIStock;
  }, null);

  return lowestRSIStock;
}
