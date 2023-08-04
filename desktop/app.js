let lib = require('trading_bot');

//prompt user for values
let alphaInsiderApiKey = '';
let strategyId = '';
let marginMultiplier = 1;
let bufferAmount = 0;

let alpacaKey = '';
let alpacaSecret = '';

let alphaInsider = new lib.AlphaInsider({
  api_key: alphaInsiderApiKey,
  strategy_id: strategyId
});
let alpaca = new lib.Alpaca({
  key: alpacaKey,
  secret: alpacaSecret,
  account_type: 'paper'
});
let bot = new lib.Bot({
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
