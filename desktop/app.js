let lib = require('trading_bot');

//prompt user for values
let alphaInsiderApiKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ0b2tlbl9pZCI6ImlSZHl2SGxSYzl2ZmI4ZXJkSHRTdCIsInVzZXJfaWQiOiJHaWdhQ2hhZCIsImhvbGRlciI6IkdpZ2FDaGFkIiwidHlwZSI6ImFwaSIsIm5hbWUiOiJUZXN0IC0gVHJhZGluZyBCb3QiLCJzY29wZSI6WyJnZXRVc2VySW5mbyIsInVwZGF0ZVVzZXJJbmZvIiwidXBkYXRlVXNlck5vdGlmaWNhdGlvbnMiLCJnZXRLeWNQb3J0YWwiLCJnZXRTdHJhdGVnaWVzIiwiZ2V0U3RyYXRlZ3lWYWx1ZXMiLCJnZXRVc2VyU3RyYXRlZ2llcyIsImdldFN0cmF0ZWd5UGVyZm9ybWFuY2UiLCJuZXdTdHJhdGVneSIsInVwZGF0ZVN0cmF0ZWd5IiwidXBkYXRlU3RyYXRlZ3lQcmljZSIsImRlbGV0ZVN0cmF0ZWd5IiwiZ2V0U3RyYXRlZ3lTdWJzY3JpcHRpb25zIiwibmV3U3RyYXRlZ3lTdWJzY3JpcHRpb24iLCJkZWxldGVTdHJhdGVneVN1YnNjcmlwdGlvbiIsInVwZGF0ZVN0cmF0ZWd5U3Vic2NyaXB0aW9uTm90aWZpY2F0aW9ucyIsInVwZGF0ZVN0cmF0ZWd5Q2FsY3VsYXRpb24iLCJkZWxldGVTdHJhdGVneUNhbGN1bGF0aW9uIiwiZ2V0QWNjb3VudFN1YnNjcmlwdGlvbiIsInVwZGF0ZUFjY291bnRTdWJzY3JpcHRpb24iLCJnZXRQYXltZW50U291cmNlcyIsImdldFBheW1lbnRTZXR1cCIsInVwZGF0ZVByaW1hcnlQYXltZW50U291cmNlIiwiZGVsZXRlUGF5bWVudFNvdXJjZSIsImdldFVwY29taW5nSW52b2ljZSIsImdldEludm9pY2VzIiwiZ2V0SW52b2ljZVBkZiIsInJldHJ5SW52b2ljZSIsImdldFVwY29taW5nSW52b2ljZUl0ZW1zIiwiZ2V0SW52b2ljZUl0ZW1zIiwiZ2V0VXNlckJhbGFuY2UiLCJnZXRQYXlvdXRzIiwibmV3UGF5b3V0IiwiZ2V0VGltZWxpbmVzIiwiZ2V0U3RyYXRlZ3lUaW1lbGluZXMiLCJuZXdQb3N0IiwicHJldmlld1Bvc3QiLCJkZWxldGVQb3N0IiwibGlrZSIsInVubGlrZSIsImdldFBvc2l0aW9ucyIsImdldENhdGVnb3JpZXMiLCJnZXRPcmRlcnMiLCJuZXdPcmRlciIsImRlbGV0ZU9yZGVyIiwid3NTdHJhdGVneVZhbHVlIiwid3NTdG9ja1ByaWNlIiwid3NPcmRlcnMiLCJ3c1Bvc2l0aW9ucyIsIndzVGltZWxpbmVzIl0sImlhdCI6MTY4NTQ3NzAxOH0.p6Ww_SAhsrVG24oHN_jTe2Y6YBgVGqKfv7rskS6_lb0';
let strategyId = 'yeyxloyV3HzVbibVGEqZE';
let marginMultiplier = 1;
let bufferAmount = 0;

let alpacaKey = 'PKIJG7ILH8DRFRRA3LI4';
let alpacaSecret = 'W90LGR1xv971UkMWzgsQNyXxiimhI8OYCrtghhDN';

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
