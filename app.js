const express = require('express');
const app = express();

const lib = require('./src/index.js');


app.get('/', (req, res) => {
  res.send('Hello World!')
})

app.listen(process.env['PORT'] || 3000, () => {
  console.log(`Trader bot is listening on port ${process.env['PORT'] || 3000}`)
});
  
// Start Worker
(async () => {
  let alphaInsider = await lib.AlphaInsider({
    api_key: process.env['ALPHAINSIDER_API_KEY'],
    strategy_id: process.env['STRATEGY_ID']
  });
  let alpaca = await lib.Alpaca({
    key: process.env['ALPACA_KEY'],
    secret: process.env['ALPACA_SECRET'],
    account_type: process.env['ALPACA_ACCOUNT_TYPE']
  });
  let bot = await lib.Bot({
    AlphaInsider: alphaInsider,
    Broker: alpaca,
    margin_type: 'reg_t',
    multiplier: 1,
    buffer_amount: 0
  });

//watch for trades and rebalance
  alphaInsider.wsPositions(async () => {
    console.log('REBALANCE');
    await bot.rebalance();
  })
  .catch((error) => {
    console.log('ERROR');
    console.log(error);
  });
})();
