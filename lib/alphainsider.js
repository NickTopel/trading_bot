const _ = require('lodash');
const j = require('joi');
const axios = require('axios');
const math = require('mathjs');
const WebSocket = require('ws');

class AlphaInsider {
  //DONE: constructor <api_key> <strategy_id>
  constructor(params) {
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
  
  //CHECK: wsPositions <cb>
  async wsPositions(cb) {
    return new Promise((resolve, reject) => {
      //validate
      j.assert(cb, j.any().required());
      
      //init
      let endpoint = ((process.env['NODE_ENV'] === 'development') ? 'ws://127.0.0.1:3000' : 'wss://alphainsider.com/ws');
      let channel = 'wsPositions:'+this.strategyId;
      
      //reset existing websocket
      if(this.ws) {
        clearInterval(this.ws.heartbeat);
        this.ws.removeAllListeners();
        this.ws.terminate();
        this.ws = undefined;
      }
      
      //start new websocket
      this.ws = new WebSocket(endpoint);
      
      //start heartbeat
      this.ws.heartbeat = setInterval(() => {
        //if connected and subscribed, ping
        if(this.ws.isConnected && this.ws.isSubscribed) {
          this.ws.isConnected = false;
          this.ws.ping();
        }
        //else, reconnect
        else {
          this.wsPositions(cb).catch(reject);
        }
      }, 30000);
      
      //on open, subscribe to strategy positions
      this.ws.on('open', () => {
        //set connected flag
        this.ws.isConnected = true;
        //subscribe to strategy positions
        this.ws.send(JSON.stringify({
          event: 'subscribe',
          payload: {
            channels: [channel],
            token: this.apiKey
          }
        }));
      });
      
      //on message, run callback function
      this.ws.on('message', (data) => {
        //parse message
        let response = JSON.parse(data);
        //subscribed, set subscribed flag
        if(response.event === 'subscribe' && response.response.includes(channel)) {
          this.ws.isSubscribed = true;
        }
        //positions, run callback function
        else if(response.event === 'wsPositions' && response.channel === channel) {
          Promise.resolve(response.response).then(cb).catch(reject);
        }
        //error, reconnect
        else if(response.event === 'error') {
          reject(response.response);
        }
      });
      
      //on pong, set connected flag
      this.ws.on('pong', () => {
        this.ws.isConnected = true;
      });
      
      //on close, reconnect
      this.ws.on('close', (data) => {
        console.log('Websocket CLOSED - Reconnecting...');
        setTimeout(() => this.wsPositions(cb).catch(reject), 3000);
      });
      
      //on error, reconnect
      this.ws.on('error', (error) => {
        console.log('Websocket ERROR - Reconnecting...');
        setTimeout(() => this.wsPositions(cb).catch(reject), 3000);
      });
    })
    
    //handle exit errors
    .catch((error) => {
      //reset existing websocket
      if(this.ws) {
        clearInterval(this.ws.heartbeat);
        this.ws.removeAllListeners();
        this.ws.terminate();
        this.ws = undefined;
      }
      //propagate error upwards
      throw error;
    });
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