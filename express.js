const path = require('path');
const express = require('express');
const api = express.Router();

let worker = require('./worker');

const app = express();

//Router Defaults
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(process.env['PORT'] || 3000, () => {
  console.log(`Example app listening on port ${process.env['PORT'] || 3000}`)
});

//Router config
app.use('/api', api);
app.use(express.static(path.join(__dirname, 'public')));

//RUN trading bot
let alphaInsider = new worker.AlphaInsider({
  api_key: process.env['ALPHAINSIDER_API_KEY'],
  strategy_id: process.env['STRATEGY_ID']
});
let alpaca = new worker.Alpaca({
  key: process.env['ALPACA_KEY'],
  secret: process.env['ALPACA_SECRET']
});
let bot = new worker.Bot({
  AlphaInsider: alphaInsider,
  Broker: alpaca,
  multiplier: process.env['MARGIN_MULTIPLIER'] || 1,
  buffer_amount: process.env['BUFFER_AMOUNT'] || 0
});

//connect to websocket
alphaInsider.wsConnect();

//on trade, rebalance
alphaInsider.on('message', async (message) => {
  console.log('REBALANCE');
  await bot.rebalance().catch((error) => {
    //print error message
    worker.reports.errorLog({
      type: 'rebalance_error',
      info: {},
      message: error
    });
  });
});

//on error, log error
alphaInsider.on('error', (error) => {
  //print error message
  worker.reports.errorLog({
    type: 'alphainsider_error',
    info: {},
    message: error
  });
});

//on close, close all positions
alphaInsider.on('close', async () => {
  console.log('CLOSE ALL POSITIONS');
  await alpaca.closeAllPositions().catch((error) => {
    //print error message
    worker.reports.errorLog({
      type: 'close_all_positions_error',
      info: {},
      message: error
    });
  });
  await new Promise(resolve => setTimeout(resolve, 60*1000));
  await alphaInsider.wsConnect();
});
