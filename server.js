const path = require('path');
const server = require('express');

let lib = require('./lib');

const app = server();
app.use(server.static(path.join(__dirname, 'public')));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(process.env['PORT'] || 3000, () => {
  console.log(`Example app listening on port ${process.env['PORT'] || 3000}`)
});

//RUN trading bot
let alphaInsider = new lib.AlphaInsider({
  api_key: process.env['ALPHAINSIDER_API_KEY'],
  strategy_id: process.env['STRATEGY_ID']
});
let alpaca = new lib.Alpaca({
  key: process.env['ALPACA_KEY'],
  secret: process.env['ALPACA_SECRET']
});
let bot = new lib.Bot({
  AlphaInsider: alphaInsider,
  Broker: alpaca,
  margin_type: 'reg_t',
  multiplier: process.env['MARGIN_MULTIPLIER'] || 1,
  buffer_amount: process.env['BUFFER_AMOUNT'] || 0
});

//connect to websocket
alphaInsider.wsConnect();

//on trade, rebalance
alphaInsider.on('message', (message) => {
  console.log('REBALANCE');
  bot.rebalance();
});

//on error, log error
alphaInsider.on('error', (error) => {
  console.log('ERROR');
  console.log(error);
});

//on close, close all positions
alphaInsider.on('close', async () => {
  console.log('CLOSE ALL POSITIONS');
  await alpaca.closeAllPositions();
  await new Promise(resolve => setTimeout(resolve, 60*1000));
  alphaInsider.wsConnect();
});
