import _ from 'lodash';
import j from 'joi';
import * as math from 'mathjs';
import AlpacaAPI from '@alpacahq/alpaca-trade-api';
import fs from "fs";

class Alpaca {
  //CHECK: constructor <key> <secret> <account_type>
  constructor(params) {
    //validate
    j.assert(params, j.object({
      key: j.string().required(),
      secret: j.string().required(),
      account_type: j.string().valid('live', 'paper').required()
    }).required());
    
    //data
    this.accountType = params.account_type;
    this.alp = new AlpacaAPI({
      keyId: params.key,
      secretKey: params.secret,
      paper: this.accountType === 'paper'
    });
    
    this.brokerStocks = undefined;
    
    //init
    this.ready = (async () => {})();
  }
  
  //CHECK: mapStocks <[{alpha_stocks}]>
  //TODO: remove fs
  async mapStocks(params) {
    //validate
    j.assert(params, j.object({
      alpha_stocks: j.array().items(j.object().required()).required()
    }).required());
    
    //get stocks
    let alphaStocks = params.alpha_stocks;
    /*let [brokerStocks, brokerCrypto] = await Promise.all([
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
    let brokerStockKeys = {...stockKeys, ...cryptoKeys};*/
    
    //TODO: remove
    //fs.writeFileSync('brokerStockKeys.json', JSON.stringify(brokerStockKeys));
    let rawBrokerStockKeys = fs.readFileSync('brokerStockKeys.json');
    let brokerStockKeys = JSON.parse(rawBrokerStockKeys);
    
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
  
  //TODO: getStockPrices <[broker_stock_ids]>
  //change bid and ask to last price
  async getStockPrices(params) {
    //validate
    j.assert(params, j.object({
      broker_stock_ids: j.array().items(j.string().required()).required()
    }).required());
    
    //separate stocks and crypto
    let {stocks, crypto} = params.broker_stock_ids.reduce((prev, curr) => {
      let brokerStock = this.brokerStocks[curr];
      if(brokerStock.security === 'stock') prev.stocks = [...prev.stocks, brokerStock.id];
      else prev.crypto = [...prev.crypto, brokerStock.id];
      return prev;
    }, {stocks: [], crypto: []});
    
    //get stocks and crypto quotes
    let [stockQuotes, cryptoQuotes] = await Promise.all([
      ((stocks.length > 0) ? this.alp.getLatestQuotes(stocks) : []),
      ((crypto.length > 0) ? this.alp.getLatestCryptoQuotes(crypto) : [])
    ]);
    let quotes = {...Object.fromEntries(stockQuotes), ...Object.fromEntries(cryptoQuotes)};
    
    //format quotes
    let formattedQuotes = params.broker_stock_ids.reduce((prev, curr) => {
      let brokerStock = this.brokerStocks[curr];
      let quote = quotes[brokerStock.id];
      prev[curr] = {
        bid: ((_.isNumber(quote.BidPrice)) ? quote.BidPrice+'' : undefined),
        ask: ((_.isNumber(quote.AskPrice)) ? quote.AskPrice+'' : undefined)
      }
      return prev;
    }, {});
    
    //return
    return formattedQuotes;
  }
  
  //CHECK: getAccountDetails
  async getAccountDetails() {
    //get account details
    let accountDetails = await this.alp.getAccount();
    
    //check what margin types are available on this user account
    let marginTypes = [];
    if(!accountDetails.trading_blocked) {
      marginTypes.push('exchange');
      if(accountDetails.shorting_enabled) marginTypes.push('reg_t');
    }
    
    //return
    return {
      account_id: accountDetails.id,
      account_type: this.accountType,
      margin_types_available: marginTypes,
      portfolio_value: accountDetails.portfolio_value
    }
  }
  
  //CHECK: getPositions
  async getPositions() {
    //get positions and account details
    let [brokerPositions, accountDetails] = await Promise.all([
      this.alp.getPositions(),
      this.alp.getAccount()
    ]);
    
    //convert crypto symbols
    brokerPositions = brokerPositions.map((position) => {
      if(position.asset_class === 'crypto' && !position.symbol.includes('/')) {
        position.symbol = _.trimEnd(position.symbol, 'USD') + '/USD';
      }
      return position;
    });
    
    //get stock prices
    let stockPrices = {};
    if(brokerPositions.length > 0) {
      stockPrices = await this.getStockPrices({
        broker_stock_ids: _.map(brokerPositions, 'symbol')
      });
    }
    
    //map prices to positions
    brokerPositions = brokerPositions.map((position) => {
      return {
        id: position.symbol,
        amount: position.qty,
        bid: stockPrices[position.symbol].bid,
        ask: stockPrices[position.symbol].ask
      }
    });
    
    //add cash to broker positions
    brokerPositions.push({
      id: undefined,
      amount: accountDetails.cash,
      bid: '1',
      ask: '1'
    });
    
    //return
    return brokerPositions;
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
  
  //CHECK: getOpenOrders
  async getOpenOrders() {
    //get all open orders
    let getAllOrders = async (after = undefined, limit = 200) => {
      let orders = await this.alp.getOrders({
        status: 'open',
        direction: 'asc',
        limit: limit,
        after: after
      });
      if(orders.length >= limit) {
        let lastOrder = _.last(orders);
        let moreOrders = await getAllOrders(lastOrder.submitted_at);
        return _.concat(orders, moreOrders);
      }
      return orders;
    }
    let allOrders = await getAllOrders();
    
    //return
    return this._formatOrders({orders: allOrders});
  }
  
  //CHECK: newOrder <broker_stock_id> <type> <action> <amount> <price>
  async newOrder(params) {
    //validate
    j.assert(params, j.object({
      broker_stock_id: j.string().required(),
      type: j.string().valid('close', 'sell_long', 'buy_short', 'buy_long', 'sell_short').required(),
      action: j.string().valid('buy', 'sell').required(),
      amount: j.number().unsafe().greater(0).required(),
      price: j.number().min(0).required(),
    }).required());
    
    //get stock
    let brokerStock = this.brokerStocks[params.broker_stock_id];
    let symbol = _.replace(brokerStock.id, '/', '');
    
    //round amount
    let amount = math.fix(params.amount, brokerStock.precision_amount).toString();
    if(['sell_short'].includes(params.type)) {
      amount = math.fix(params.amount, 0).toString();
    }
    
    //skip order if less than min_total
    let isLessThanMinTotal = math.evaluate('bignumber(a) * bignumber(b) < bignumber(c)', {a: amount, b: params.price, c: brokerStock.min_total});
    if(params.type !== 'close' && isLessThanMinTotal) return undefined;
    
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

export default async (params) => {
  let newClass = new Alpaca(params);
  await newClass.ready;
  return newClass;
};