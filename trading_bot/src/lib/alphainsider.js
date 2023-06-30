import _ from 'lodash';
import j from 'joi';
import axios from 'axios';
import * as math from 'mathjs';
import {EventEmitter} from 'events';
import Sockette from 'sockette';
import WebSocket from 'ws'; global.WebSocket = WebSocket;

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
    
    this.alphaStocks = undefined;
    
    //init
    this.ready = (async () => {
      await this.wsPositions();
    })();
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
    //get strategy details
    let strategyDetails = await axios({
      method: 'get',
      headers: {
        authorization: this.apiKey
      },
      url: 'https://alphainsider.com/api/getStrategies',
      params: {
        strategy_id: [this.strategyId]
      }
    })
    .then((data) => data.data.response[0]);
    
    //return
    return strategyDetails;
  }
  
  //CHECK: getPositions
  async getPositions() {
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
  
  //TODO: wsPositions
  //make program not hang if not using wsPositions
  async wsPositions() {
    //subscribe to wsPositions
    let subscribe = (ws) => {
      ws.json({
        event: 'subscribe',
        payload: {
          channels: ['wsPositions:'+this.strategyId],
          token: this.apiKey
        }
      });
    }
    
    //handle messages
    let handleMessage = (data) => {
      let response = JSON.parse(data);
      if(response.event === 'wsPositions') {
        this.emit('trade', response.response);
      }
    }
    
    //handle errors
    let handleError = (error) => {
      
    }
    
    //start websocket
    let ws = new Sockette('wss://alphainsider.com/ws', {
      onopen: () => subscribe(ws),
      onreconnect: () => subscribe(ws),
      onmessage: (event) => handleMessage(event.data),
      onmaximum: (error) => handleError(error)
    });
  }
}

export default async (params) => {
  let newClass = new AlphaInsider(params);
  await newClass.ready;
  return newClass;
};