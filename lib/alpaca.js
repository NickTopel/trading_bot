const _ = require('lodash');
const j = require('joi');
const math = require('mathjs');
const AlpacaAPI = require('@alpacahq/alpaca-trade-api');

class Alpaca {
  //CHECK: constructor <key> <secret>
  constructor(params) {
    //validate
    j.assert(params, j.object({
      key: j.string().required(),
      secret: j.string().required()
    }).required());
    
    //data
    this.alp = new AlpacaAPI({
      keyId: params.key,
      secretKey: params.secret,
      paper: _.startsWith(params.key, 'P')
    });
    
    this.orderBuffer = '0.05';
    this.brokerStocks = undefined;
    
    //init
    this.ready = (async () => {})();
  }
  
  //CHECK: mapStocks <[{alpha_stocks}]>
  async mapStocks(params) {
    //validate
    j.assert(params, j.object({
      alpha_stocks: j.array().items(j.object().required()).required()
    }).required());
    
    //get stocks
    let alphaStocks = params.alpha_stocks;
    let [brokerStocks, brokerCrypto] = await Promise.all([
      this.alp.getAssets({status: 'active'}),
      this.alp.getAssets({asset_class: 'crypto', status: 'active'})
    ]);
    
    //key stocks
    let stockKeys = _.chain(brokerStocks).filter((item) => item.tradable === true).keyBy('symbol').value();
    let cryptoKeys = _.chain(brokerCrypto).filter((item) => item.tradable === true).reduce((prev, curr) => {
      prev[curr.symbol] = curr;
      prev[_.replace(curr.symbol, '/', '')] = curr;
      return prev;
    }, {}).value();
    let brokerStockKeys = {...stockKeys, ...cryptoKeys};
    
    //set broker stocks
    let calcPrecision = (increment) => {
      let decimalPart = (increment+'').split('.')[1];
      return ((decimalPart) ? decimalPart.length : 0);
    };
    this.brokerStocks = _.mapValues(brokerStockKeys, (brokerStock) => {
      return {
        id: brokerStock.symbol,
        symbol: brokerStock.symbol,
        security: ((brokerStock.class === 'crypto') ? 'cryptocurrency' : 'stock'),
        marginable: brokerStock.marginable,
        fractionable: brokerStock.fractionable,
        min_total: '1',
        precision_amount: ((brokerStock.min_trade_increment) ? calcPrecision(brokerStock.min_trade_increment) : (brokerStock.fractionable) ? 9 : 0)
      }
    });
    
    //map Alpaca stocks to AlphaInsider
    let stockMap = _.reduce(alphaStocks, (prev, curr) => {
      let brokerStockSymbol = this._getStockSymbol({alpha_stock: curr});
      let brokerStock = this.brokerStocks[brokerStockSymbol];
      prev[curr.stock_id] = ((brokerStock) ? brokerStock.id : undefined);
      return prev;
    }, {});
    
    //return
    return stockMap;
  }
  
  //CHECK: getAccountDetails
  async getAccountDetails() {
    //get account details and positions
    let [accountDetails, positions] = await Promise.all([
      this.alp.getAccount(),
      this.alp.getPositions()
    ]);
    
    //calculate buying power
    let buyingPower = math.evaluate('bignumber(a) * 2', {a: accountDetails.portfolio_value}).toString();
    if(accountDetails.pattern_day_trader) {
      let startOfDayBuyingPower = math.evaluate('4 * (bignumber(a) - bignumber(b))', {a: accountDetails.last_equity, b: accountDetails.last_maintenance_margin}).toString();
      if(math.evaluate('a < b', {a: startOfDayBuyingPower, b: buyingPower})) buyingPower = startOfDayBuyingPower;
    }
    
    //format positions
    positions = positions.map((position) => {
      if(position.asset_class === 'crypto' && !position.symbol.includes('/')) {
        position.symbol = _.trimEnd(position.symbol, 'USD') + '/USD';
      }
      return {
        id: position.symbol,
        amount: position.qty,
        bid: undefined,
        ask: undefined
      };
    });
    
    //return
    return {
      account_id: accountDetails.id,
      margin_types_available: ['reg_t'],
      order_buffer: this.orderBuffer,
      value: accountDetails.portfolio_value,
      buying_power: buyingPower,
      positions: positions
    }
  }
  
  //CHECK: closeAllPositions
  async closeAllPositions() {
    //close all positions
    let orders = await this.alp.closeAllPositions();
    orders = _.map(orders, 'body');
    
    //wait for all positions to close, expire 10s
    await this._wait(async (time) => {
      //error, waited too long
      if(time >= 10) throw new Error('Failed to close all positions.');
      //get positions
      let positions = await this.alp.getPositions();
      //repeat if openOrders still exist
      return positions.length > 0;
    }, 1000);
    
    //return
    return this._formatOrders({orders: orders});
  }
  
  //CHECK: newOrder <broker_stock_id> <type> <action> <amount>
  async newOrder(params) {
    //validate
    j.assert(params, j.object({
      broker_stock_id: j.string().required(),
      type: j.string().valid('close', 'sell_long', 'buy_short', 'buy_long', 'sell_short').required(),
      action: j.string().valid('buy', 'sell').required(),
      amount: j.number().unsafe().greater(0).required()
    }).required());
    
    //get stock
    let brokerStock = this.brokerStocks[params.broker_stock_id];
    let symbol = _.replace(brokerStock.id, '/', '');
    
    //round amount
    let amount = math.fix(params.amount, brokerStock.precision_amount).toString();
    if(['sell_short'].includes(params.type)) {
      amount = math.fix(params.amount, 0).toString();
    }
    
    //skip if amount is zero
    if(math.evaluate('bignumber(a) == 0', {a: amount})) return undefined;
    
    //close position
    let order = undefined;
    if(params.type === 'close') {
      order = await this.alp.closePosition(symbol);
    }
    //buy or sell
    else {
      order = await this.alp.createOrder({
        symbol: symbol,
        side: params.action,
        type: 'market',
        time_in_force: ((brokerStock.security === 'stock') ? 'day' : 'gtc'),
        qty: amount
      });
    }
    
    //wait for order to complete, expire 10s
    await this._wait(async (time) => {
      //error, waited too long
      if(time >= 10) throw new Error('Order failed to complete.');
      //get order
      order = await this.alp.getOrder(order.id);
      //repeat if order is not filled
      return order.status !== 'filled';
    }, 1000);
    
    //return
    return this._formatOrders({orders: [order]})[0];
  }
  
  //CHECK: cancelAllOpenOrders
  async cancelAllOpenOrders() {
    //cancel all orders
    let canceledOrders = await this.alp.cancelAllOrders();
    
    //wait for all open orders to cancel, expire 10s
    await this._wait(async (time) => {
      //error, waited too long
      if(time >= 10) throw new Error('Failed to cancel all open orders.');
      //get open orders
      let openOrders = await this.alp.getOrders({status: 'open'});
      //repeat if openOrders still exist
      return openOrders.length > 0;
    }, 1000);
    
    //return
    return this._formatOrders({orders: canceledOrders});
  }
  
  //CHECK: destroy
  async destroy() {}
  
  //CHECK: _wait <fn> --wait--
  async _wait(fn, wait = 1000, start = Date.now()) {
    //wait
    await new Promise(resolve => setTimeout(resolve, wait));
    //execute function
    let repeat = await fn((Date.now()-start)/1000);
    //repeat
    if(repeat) {
      //repeat
      return this._wait(fn, wait, start);
    }
  }
  
  //CHECK: _getStockSymbol <{alpha_stock}>
  _getStockSymbol(params) {
    //validate
    j.assert(params, j.object({
      alpha_stock: j.object().required()
    }).required());
    
    //alpha stock
    let alphaStock = params.alpha_stock;
    
    //handle stock symbol
    if(alphaStock.security === 'stock') {
      return alphaStock.stock;
    }
    
    //handle crypto symbol
    else if(alphaStock.security === 'cryptocurrency') {
      return _.trimEnd(alphaStock.stock, '-USD') + '/USD';
    }
    
    //else, undefined
    else {
      return undefined;
    }
  }
  
  //CHECK: _formatOrders --[{orders}]--
  _formatOrders(params) {
    //validate
    j.assert(params, j.object({
      orders: j.array().items(j.object().optional()).required()
    }).required());
    
    //format orders
    return _.map(params.orders, 'id');
  }
}

module.exports = Alpaca;