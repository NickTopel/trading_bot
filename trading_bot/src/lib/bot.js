import _ from 'lodash';
import j from 'joi';
import * as math from 'mathjs';

import * as fs from 'fs';

class Bot {
  //CHECK: constructor <AlphaInsider> <Broker> <margin_type> --multiplier-- --buffer_amount--
  constructor(params) {
    //validate
    j.assert(params, j.object({
      AlphaInsider: j.any().required(),
      Broker: j.any().required(),
      margin_type: j.string().valid('exchange', 'reg_t', 'portfolio').required(),
      multiplier: j.number().greater(0).max(10).optional(),
      buffer_amount: j.number().min(0).optional()
    }).required());
    
    //data
    this.AlphaInsider = undefined;
    this.Broker = undefined;
    this.marginType = params.margin_type;
    this.multiplier = ((params.multiplier !== undefined) ? params.multiplier : 1);
    this.buffer_amount = ((params.buffer_amount !== undefined) ? params.buffer_amount : 0);
    
    this.alphaBrokerIndex = undefined;
    
    //init
    this.ready = (async () => {
      this.AlphaInsider = await params.AlphaInsider;
      this.Broker = await params.Broker;
      await this.mapStocks();
    })();
  }
  
  //TODO: validate
  //validate margin type available with broker
  
  //CHECK: mapStocks
  //TODO: remove fs
  async mapStocks() {
    //get all AlphaInsider stocks
    //let alphaStocks = await this.AlphaInsider.getAllStocks();
    
    let rawAlphaStocks = fs.readFileSync('alphaStocks.json');
    let alphaStocks = JSON.parse(rawAlphaStocks);
    
    //map stocks and set alphaBrokerIndex
    this.alphaBrokerIndex = await this.Broker.mapStocks({alpha_stocks: alphaStocks});
  }
  
  //CHECK: executeOrders <[{orders}]>
  async executeOrders(params) {
    //validate
    j.assert(params, j.object({
      orders: j.array().items(j.object().optional()).required()
    }).required());
    
    //group orders for parallel execution
    let closePositions = _.filter(params.orders, (item) => ['close'].includes(item.type));
    let decreasePositions = _.filter(params.orders, (item) => ['sell_long', 'buy_short'].includes(item.type));
    let increasePositions = _.filter(params.orders, (item) => ['buy_long', 'sell_short'].includes(item.type));
    
    //foreach group of orders
    let executedOrders = await [closePositions, decreasePositions, increasePositions].reduce((chain, curr) => chain.then(async (prev) => {
      //foreach order
      let orders = await Promise.all(curr.map(async (order) => {
        //execute order
        return this.Broker.newOrder({
          broker_stock_id: order.id,
          type: order.type,
          action: ((math.evaluate('a >= 0', {a: order.amount})) ? 'buy' : 'sell'),
          amount: math.evaluate('abs(bignumber(a))', {a: order.amount}).toString(),
          price: order.price
        });
      }));
      //return
      return _.concat(prev, orders);
    }), Promise.resolve([]));
    
    //return
    return _.compact(executedOrders);
  }
  
  //TODO: calculateNewOrders
  //find solution to 300% long and 200% short issue.
  async calculateNewOrders() {
    //get strategy positions
    //get broker positions
    //get broker value
    
    //calculate strategy value
    //calculate broker value
    
    
    
    
    
    
    
    //get strategy and broker positions
    let [strategyPositions, brokerPositions] = await Promise.all([
      this.AlphaInsider.getPositions(),
      this.Broker.getPositions()
    ]);
    
    //calculate strategy and broker value
    let strategyValue = math.evaluate('sum(bignumber(a))', {
      a: strategyPositions.map((position) => {
        let price = ((math.evaluate('a >= 0', {a: position.amount})) ? position.bid : position.ask);
        return math.evaluate('bignumber(a) * bignumber(b)', {a: position.amount, b: price}).toString();
      })
    }).toString();
    let brokerValue = math.evaluate('sum(bignumber(a))', {
      a: brokerPositions.map((position) => {
        let price = ((math.evaluate('a >= 0', {a: position.amount})) ? position.bid : position.ask);
        return math.evaluate('bignumber(a) * bignumber(b)', {a: position.amount, b: price}).toString();
      })
    }).toString();
    
    //update broker value with buffer amount, margin type, and multiplier
    brokerValue = math.evaluate('(bignumber(a) - bignumber(b)) * bignumber(c) * bignumber(d)', {
      a: brokerValue,
      b: this.buffer_amount,
      c: ((this.marginType === 'reg_t') ? '0.4' : '1'),
      d: this.multiplier
    }).toString();
    
    //remove cash from strategy positions and broker positions
    strategyPositions = strategyPositions.filter((position) => !!position.id);
    brokerPositions = brokerPositions.filter((position) => !!position.id);
    
    //calculate strategy position percentages
    let strategyPositionPercents = strategyPositions.map((position) => {
      let price = ((math.evaluate('a >= 0', {a: position.amount})) ? position.bid : position.ask);
      return {
        ...position,
        percent: math.evaluate('bignumber(a) * bignumber(b) / bignumber(c)', {a: position.amount, b: price, c: strategyValue}).toString()
      }
    });
    
    //get remaining broker final position prices
    let brokerFinalPositionPrices = brokerPositions.reduce((prev, curr) => {
      prev[curr.id] = {bid: curr.bid, ask: curr.ask}
      return prev;
    }, {});
    let remainingStockIds = _.difference(strategyPositions.map((position) => this.alphaBrokerIndex[position.id]), Object.keys(brokerFinalPositionPrices));
    if(remainingStockIds.length > 0) {
      brokerFinalPositionPrices = {
        ...brokerFinalPositionPrices,
        ...(await this.Broker.getStockPrices({
          broker_stock_ids: remainingStockIds
        }))
      }
    }
    
    //current state
    let currentState = _.reduce(brokerPositions, (prev, curr) => {
      prev[curr.id] = curr.amount;
      return prev;
    }, {});
    
    //final state
    let finalState = _.reduce(strategyPositionPercents, (prev, curr) => {
      let brokerId = this.alphaBrokerIndex[curr.id];
      let price = ((math.evaluate('a >= 0', {a: curr.amount})) ? brokerFinalPositionPrices[brokerId].bid : brokerFinalPositionPrices[brokerId].ask);
      prev[brokerId] = math.evaluate('bignumber(a) * bignumber(b) / bignumber(c)', {
        a: brokerValue,
        b: curr.percent,
        c: price
      }).toString();
      return prev;
    }, {});
    
    //calculate new orders to go from current broker state to final broker state
    let isPositive = (a) => math.evaluate('bignumber(a) > 0', {a: a});
    let subtract = (a, b) => math.evaluate('bignumber(a) - bignumber(b)', {a: a, b: b}).toString();
    let percent = (a, b) => math.evaluate('bignumber(a) * bignumber(b) / bignumber(c)', {a: a, b: b, c: brokerValue}).toString()
    let newOrders = _.union(Object.keys(currentState), Object.keys(finalState)).reduce((prev, curr) => {
      //get values
      let currentAmount = currentState[curr] || 0;
      let finalAmount = finalState[curr] || 0;
      let action = ((math.evaluate('bignumber(a) <= bignumber(b)', {a: currentAmount, b: finalAmount})) ? 'buy' : 'sell')
      let price = ((action === 'buy') ? brokerFinalPositionPrices[curr].ask : brokerFinalPositionPrices[curr].bid);
      let oppositeSigns = math.evaluate('bignumber(a) * bignumber(b) < 0', {a: currentAmount, b: finalAmount});
      
      //if equal, skip
      if(math.evaluate('bignumber(a) == bignumber(b)', {a: currentAmount, b: finalAmount})) return prev;
      
      //close opposite positions and unmatched positions
      if(oppositeSigns || math.evaluate('bignumber(a) != 0 and bignumber(b) == 0', {a: currentAmount, b: finalAmount})) {
        let amount = subtract(0, currentAmount);
        prev.push({id: curr, type: 'close', amount: amount, price: price, percent: percent(amount, price)});
        currentAmount = 0;
      }
      
      //increase or decrease positions
      let amount = subtract(finalAmount, currentAmount);
      if(math.evaluate('bignumber(a) != 0', {a: amount})) {
        //determine order type
        let type = undefined;
        if(action === 'sell' && isPositive(finalAmount)) type = 'sell_long';
        if(action === 'buy' && !isPositive(finalAmount)) type = 'buy_short';
        if(action === 'buy' && isPositive(finalAmount)) type = 'buy_long';
        if(action === 'sell' && !isPositive(finalAmount)) type = 'sell_short';
        //create new order
        prev.push({id: curr, type: type, amount: amount, price: price, percent: percent(amount, price)});
      }
      //return
      return prev;
    }, []);
    
    //return
    return newOrders;
  }
  
  //TODO: rebalance
  //add flag to prevent multiple rebalance operations running at once
  async rebalance() {
    //cancel all open orders
    await this.Broker.cancelAllOpenOrders();
    
    //calculate new orders
    let newOrders = await this.calculateNewOrders();
    
    //execute new orders
    let orders = await this.executeOrders({orders: newOrders});
    
    //return
    return orders;
    
    //TODO: handle errors
  }
  
  //TODO: error <type> <message>
    //cancel all open orders
    //close all positions
    //send notification
}

export default async (params) => {
  let newClass = new Bot(params);
  await newClass.ready;
  return newClass;
};