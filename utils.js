const axios = require("axios");
require("dotenv").config();

const apiKey = process.env.ALPHA_VANTAGE_API_KEY;

function getWeeklyRSI(symbol) {
  return axios.get(
    `https://www.alphavantage.co/query?function=RSI&symbol=${symbol}&interval=weekly&time_period=10&series_type=open&apikey=${apiKey}`
  );
}

function get50SMA(symbol) {
  return axios.get(
    `https://www.alphavantage.co/query?function=SMA&symbol=${symbol}&interval=daily&time_period=50&series_type=open&apikey=${apiKey}`
  );
}

function get200SMA(symbol) {
  return axios.get(
    `https://www.alphavantage.co/query?function=SMA&symbol=${symbol}&interval=daily&time_period=200&series_type=open&apikey=${apiKey}`
  );
}

function compileStockData(symbol, sma50Data, sma200Data, weeklyRSI) {
  const crossoverDates = [];
  let is50Above200 = false;
  let lastCrossoverAbove = false;
  let latestSMA50 = null;
  let latestSMA200 = null;

  if (sma50Data && sma200Data) {
    // Extract dates and convert them to an array
    const dates = Object.keys(sma50Data);

    // Iterate through the dates in reverse order
    for (let i = dates.length - 1; i >= 0; i--) {
      const date = dates[i];

      if (sma50Data.hasOwnProperty(date) && sma200Data.hasOwnProperty(date)) {
        const sma50 = parseFloat(sma50Data[date].SMA);
        const sma200 = parseFloat(sma200Data[date].SMA);

        latestSMA50 = sma50;
        latestSMA200 = sma200;

        // Check for crossover conditions
        if (sma50 > sma200 && !is50Above200) {
          crossoverDates.push({
            date,
            crossover: "50 SMA crossed above 200 SMA",
          });
          is50Above200 = true;
          lastCrossoverAbove = true;
        } else if (sma50 < sma200 && is50Above200) {
          crossoverDates.push({
            date,
            crossover: "50 SMA crossed below 200 SMA",
          });
          is50Above200 = false;
          lastCrossoverAbove = false;
        }
      }
    }
  }
  let lastCrossOverDate = crossoverDates[crossoverDates.length - 1].date;
  let daysSinceLastCrossover = Math.abs(
    calculateDaysBetweenDates(getTodayDate(), lastCrossOverDate)
  );

  return {
    symbol: symbol,
    lastCrossoverAbove: lastCrossoverAbove,
    daysSinceLastCrossover: daysSinceLastCrossover,
    latestSMA50: latestSMA50,
    latestSMA200: latestSMA200,
    latestRSI:
      weeklyRSI.data["Technical Analysis: RSI"][
        weeklyRSI.data["Meta Data"]["3: Last Refreshed"]
      ]["RSI"],
    // crossovers: crossoverDates,
  };
}

function canBuyStock(stockData) {
  return (
    stockData.lastCrossoverAbove &&
    stockData.stockPriceOver200SMAByLessThan7Percent &&
    stockData.latestRSI < 50
  );
}

function calculateDaysBetweenDates(date1, date2) {
  const startDate = new Date(date1);
  const endDate = new Date(date2);

  // Calculate the difference in milliseconds
  const timeDifference = endDate - startDate;

  // Convert milliseconds to days
  const daysDifference = Math.floor(timeDifference / (1000 * 3600 * 24));

  return daysDifference;
}

async function getLatestStockPrice(symbol) {
  try {
    const response = await axios.get(
      `https://www.alphavantage.co/query?function=TIME_SERIES_DAILY&symbol=${symbol}&apikey=${apiKey}`
    );

    const timeSeriesData = response.data["Time Series (Daily)"];

    // Find the latest date in the time series data
    const latestDate = Object.keys(timeSeriesData)[0];

    // Get the price data for the latest date
    const latestPriceData = timeSeriesData[latestDate];
    return latestPriceData["4. close"];
  } catch (error) {
    console.error("Error fetching latest stock price:", error);
    throw error; // You can choose to handle the error as needed
  }
}

// Function to get today's date in 'YYYY-MM-DD' format
function getTodayDate() {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

module.exports = {
  getWeeklyRSI,
  get50SMA,
  get200SMA,
  compileStockData,
  getLatestStockPrice,
  canBuyStock,
};
