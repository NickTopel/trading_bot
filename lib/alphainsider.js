const _ = require('lodash');
const j = require('joi');
const axios = require('axios');
const math = require('mathjs');
const WebSocket = require('ws');
const EventEmitter = require('events');

class AlphaInsider extends EventEmitter {
  //DONE: constructor <api_key> <strategy_id>
  constructor(params) {
    //init event emitter
    super();
    
    //validate
    j.assert(params, j.object({
      api_key: j.string().required(),
      strategy_id: j.string().required()
    }).required());
    
    //data
    this.apiKey = params.api_key;
    this.strategyId = params.strategy_id;
    
    this.ws = undefined;
    
    this.alphaStocks = undefined;
  }
  
  //DONE: getAllStocks
  async getAllStocks() {
    //get all stocks
    let stocks = await axios({
      method: 'get',
      url: 'https://alphainsider.com/api/getAllStocks'
    })
    .then((data) => data.data.response);
    
    //remove cash
    stocks = stocks.filter((item) => item.stock_id !== 'ubfhvYUsgvMIuJPwr76My');
    
    //set alpha stocks
    this.alphaStocks = _.keyBy(stocks, 'stock_id');
    
    //return
    return stocks;
  }
  
  //CHECK: getStockPrices <[alpha_stock_ids]>
  async getStockPrices(params) {
    //validate
    j.assert(params, j.object({
      alpha_stock_ids: j.array().items(j.string().required()).required()
    }).required());
    
    //get stock prices
    let stocks = await axios({
      method: 'get',
      url: 'https://alphainsider.com/api/getStocks',
      params: {
        stock_id: params.alpha_stock_ids
      }
    })
    .then((data) => data.data.response);
    
    //extract stock prices
    let stockPrices = stocks.reduce((prev, curr) => {
      prev[curr.stock_id] = {
        bid: curr.bid,
        ask: curr.ask
      }
      return prev;
    }, {});
    
    //return
    return stockPrices;
  }
  
  //CHECK: getStrategyDetails
  async getStrategyDetails() {
    //get strategy details and positions
    let [strategyDetails, positions] = await Promise.all([
      axios({
        method: 'get',
        headers: {
          authorization: this.apiKey
        },
        url: 'https://alphainsider.com/api/getStrategies',
        params: {
          strategy_id: [this.strategyId]
        }
      })
      .then((data) => data.data.response[0]),
      this._getPositions()
    ]);
    
    //calculate strategy value and gross exposure
    let {strategyValue, grossExposure} = positions.reduce((prev, curr) => {
      let price = ((math.evaluate('a >= 0', {a: curr.amount})) ? curr.bid : curr.ask);
      prev.strategyValue = math.evaluate('bignumber(a) + (bignumber(b) * bignumber(c))', {a: prev.strategyValue, b: curr.amount, c: price}).toString();
      prev.grossExposure = math.evaluate('bignumber(a) + (abs(bignumber(b)) * bignumber(c))', {a: prev.grossExposure, b: curr.amount, c: price}).toString();
      return prev;
    }, {strategyValue: '0', grossExposure: '0'});
    
    //calculate buying power
    let buyingPower = math.evaluate('bignumber(a) * 5', {a: strategyValue}).toString();
    if(math.evaluate('a > b', {a: grossExposure, b: buyingPower})) buyingPower = grossExposure;
    
    //remove cash and calculate percents
    positions = positions.reduce((prev, curr) => {
      if(!curr.id) return prev;
      let price = ((math.evaluate('a >= 0', {a: curr.amount})) ? curr.bid : curr.ask);
      prev.push({
        ...curr,
        percent: math.evaluate('(abs(bignumber(a)) * bignumber(b)) / bignumber(c)', {a: curr.amount, b: price, c: buyingPower}).toString()
      });
      return prev;
    }, []);
    
    //return
    return {
      strategy_id: strategyDetails.strategy_id,
      type: strategyDetails.type,
      value: strategyValue,
      buying_power: buyingPower,
      positions: positions
    };
  }
  
  //CHECK: wsConnect
  async wsConnect() {
    //clear existing websocket
    await this.wsClose();
    
    //start new websocket
    this.ws = new WebSocket('wss://alphainsider.com/ws');
    let channels = ['wsPositions:'+this.strategyId];
    
    //start heartbeat, 30 seconds
    this.ws.heartbeat = setInterval(() => {
      //if connection open, ping
      if(this.ws.isConnected) {
        this.ws.isConnected = false;
        this.ws.ping();
      }
      //else, reconnect
      else {
        this.wsConnect();
      }
    }, 30000);
    
    //on pong, set connected
    this.ws.on('pong', () => {
      this.ws.isConnected = true;
    });
    
    //on open, subscribe to channels
    this.ws.on('open', () => {
      //set connected
      this.ws.isConnected = true;
      //subscribe
      this.ws.send(JSON.stringify({
        event: 'subscribe',
        payload: {
          channels: channels,
          token: this.apiKey
        }
      }));
    });
    
    //on message, handle events
    this.ws.on('message', async (data) => {
      //parse message
      let response = JSON.parse(data);
      //subscribe, verify subscription
      if(response.event === 'subscribe') {
        if(_.difference(channels, response.response).length !== 0) {
          //emit error
          this.emit('error', 'Websocket failed to subscribe.');
          //emit close
          this.emit('close');
          //close connection
          await this.wsClose();
        }
      }
      //wsPositions, run callback function
      else if(response.event === 'wsPositions' && channels.includes(response.channel)) {
        this.emit('message', response);
      }
      //else, close websocket
      else {
        this.ws.close(1000, 'Unhandled Event');
      }
    });
    
    //on error, console log
    this.ws.on('error', (error) => {
      this.emit('error', error);
    });
    
    //on close, delay and reconnect
    this.ws.on('close', async () => {
      console.log('Websocket CLOSED - Reconnecting...');
      await new Promise(resolve => setTimeout(resolve, 3000));
      this.wsConnect();
    });
  }
  
  //CHECK: wsClose
  async wsClose() {
    //close websocket
    if(this.ws) {
      clearInterval(this.ws.heartbeat);
      this.ws.removeAllListeners();
      this.ws.terminate();
      this.ws = undefined;
    }
  }
  
  //CHECK: _getPositions
  async _getPositions() {
    //get strategy positions
    let strategyPositions = await axios({
      method: 'get',
      headers: {
        authorization: this.apiKey
      },
      url: 'https://alphainsider.com/api/getPositions',
      params: {
        strategy_id: this.strategyId
      }
    })
    .then((data) => data.data.response);
    
    //get prices
    let positionPrices = await this.getStockPrices({alpha_stock_ids: _.map(strategyPositions, 'stock_id')});
    
    //map prices to positions
    strategyPositions = _.chain(strategyPositions).groupBy('stock_id').map((similarPositions, stockId) => {
      return {
        id: ((stockId === 'ubfhvYUsgvMIuJPwr76My') ? undefined : stockId),
        amount: math.evaluate('sum(bignumber(a))', {a: _.map(similarPositions, 'amount')}).toString(),
        bid: positionPrices[stockId].bid,
        ask: positionPrices[stockId].ask
      }
    }).value();
    
    //return
    return strategyPositions;
  }
}

module.exports = AlphaInsider;