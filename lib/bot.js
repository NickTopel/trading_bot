const _ = require('lodash');
const j = require('joi');
const math = require('mathjs');

class Bot {
  //CHECK: constructor <AlphaInsider> <Broker> --multiplier-- --buffer_amount--
  constructor(params) {
    //validate
    j.assert(params, j.object({
      AlphaInsider: j.any().required(),
      Broker: j.any().required(),
      multiplier: j.number().greater(0).max(10).optional(), 
      buffer_amount: j.number().min(0).optional()
    }).required());
    
    //data
    this.AlphaInsider = params.AlphaInsider;
    this.Broker = params.Broker;
    this.multiplier = ((params.multiplier !== undefined) ? params.multiplier : 1);
    this.bufferAmount = ((params.buffer_amount !== undefined) ? params.buffer_amount : 0);
    
    this.prevStrategyPositions = [];
    this.alphaBrokerIndex = {};
    
    this.rebalancing = false;
    this.repeatRebalance = false;
    
    //init
    this.ready = (async () => {})();
  }
  
  //CHECK: executeOrders <[{orders}]>
  async executeOrders(params) {
    //validate
    j.assert(params, j.object({
      orders: j.array().items(
        j.object().optional()
      ).required()
    }).required());
    
    //group orders for parallel execution
    let decreaseOrders = _.filter(params.orders, (item) => ['close', 'sell_long', 'buy_short'].includes(item.type));
    let increaseOrders = _.filter(params.orders, (item) => ['buy_long', 'sell_short'].includes(item.type));
    
    //decrease positions
    let executedOrders = await Promise.all(decreaseOrders.map(async (order) => {
      return this.Broker.newOrder({
        broker_stock_id: order.id,
        type: order.type,
        action: order.action,
        amount: order.amount,
        ...((order.price) ? {price: order.price} : {})
      });
    }));
    
    //increase positions
    let recursiveIncrease = async (orders) => {
      //skip if no remaining orders
      if(orders.length <= 0) return [];
      //get initial buying power
      let initialBuyingPower = await this.Broker.getInitialBuyingPower();
      //calculate effective buying power after order buffer
      let effectiveBuyingPower = math.evaluate('bignumber(a) * (1-bignumber(b))', {a: initialBuyingPower, b: this.Broker.orderBuffer}).toString();
      //break orders up into orders to execute and remaining orders
      let remainingBuyingPower = effectiveBuyingPower;
      let newOrdersToExecute = [];
      let remainingOrders = orders;
      while(remainingOrders.length > 0) {
        //get current order
        let currentOrder = remainingOrders.shift();
        //if order is less than or equal to remainingBuyingPower, add to newOrdersToExecute
        if(math.evaluate('bignumber(a) <= bignumber(b)', {a: currentOrder.total, b: remainingBuyingPower})) {
          newOrdersToExecute.push(currentOrder);
          remainingBuyingPower = math.evaluate('bignumber(a) - bignumber(b)', {a: remainingBuyingPower, b: currentOrder.total}).toString();
        }
        //else, split and add to remainingOrders
        else {
          //order to execute
          let splitOrder = {
            ...currentOrder,
            amount: math.evaluate('bignumber(a) / bignumber(b)', {a: remainingBuyingPower, b: currentOrder.price}).toString(),
            total: remainingBuyingPower
          };
          newOrdersToExecute.push(splitOrder);
          //remaining order
          let remainingOrderTotal = math.evaluate('bignumber(a) - bignumber(b)', {a: currentOrder.total, b: remainingBuyingPower}).toString();
          let remainingSplitOrder = {
            ...currentOrder,
            amount: math.evaluate('bignumber(a) / bignumber(b)', {a: remainingOrderTotal, b: currentOrder.price}).toString(),
            total: remainingOrderTotal
          };
          remainingOrders.push(remainingSplitOrder);
          //exit
          break;
        }
      }
      //execute orders
      let newExecutedOrders = await Promise.all(newOrdersToExecute.map(async (order) => {
        return this.Broker.newOrder({
          broker_stock_id: order.id,
          type: order.type,
          action: order.action,
          amount: order.amount,
          price: order.price
        });
      }));
      //return
      return newExecutedOrders.concat(await recursiveIncrease(remainingOrders));
    }
    executedOrders = executedOrders.concat(await recursiveIncrease(increaseOrders));
    
    //return
    return _.compact(executedOrders);
  }
  
  //CHECK: calculateNewOrders
  async calculateNewOrders() {
    //get strategy details and broker details
    let [strategyDetails, brokerDetails] = await Promise.all([
      this.AlphaInsider.getStrategyDetails(),
      this.Broker.getAccountDetails()
    ]);
    
    //map new or expired stock details
    let alphaStocks = await this.AlphaInsider.mapStocks({alpha_stock_ids: _.map(strategyDetails.positions, 'id')});
    let brokerStocks = await this.Broker.mapStocks({alpha_stocks: alphaStocks});
    this.alphaBrokerIndex = _.values(brokerStocks).reduce((prev, curr) => {
      prev[curr.alpha_stock.stock_id] = curr.id;
      return prev;
    }, {});
    
    //skip if positions haven't changed
    let prevStrategyPositions = this.prevStrategyPositions;
    let currStrategyPositions = _.chain(strategyDetails.positions).map(({id, amount}) => ({id, amount})).orderBy('id', 'desc').value();
    this.prevStrategyPositions = currStrategyPositions;
    if(JSON.stringify(prevStrategyPositions) === JSON.stringify(currStrategyPositions)) return [];
    
    //error if not a stock strategy
    if(strategyDetails.type !== 'stock') throw new Error('Must be a stock strategy.');
    
    //error if account is not a margin account
    if(!brokerDetails.margin_types_available.includes('reg_t')) throw new Error('Account must be a margin account.');
    
    //error if account is less than 25k
    if(math.evaluate('a < 25000', {a: brokerDetails.value})) throw new Error('Account must maintain a balance of at least $25,000.');
    
    //get prices
    let prices = _.reduce(strategyDetails.positions, (prev, curr) => {
      let brokerId = this.alphaBrokerIndex[curr.id];
      if(brokerId === undefined) throw new Error('No broker stock mapping found for stock_id: '+curr.id);
      prev[brokerId] = {bid: curr.bid, ask: curr.ask};
      return prev;
    }, {});
    
    //adjust broker buying power
    let brokerBuyingPower = math.evaluate('bignumber(a) - bignumber(b)', {
      a: brokerDetails.buying_power,
      b: this.bufferAmount
    }).toString();
    
    //current state
    let currentState = _.reduce(brokerDetails.positions, (prev, curr) => {
      prev[curr.id] = curr.amount;
      return prev;
    }, {});
    
    //final state
    let {finalState, finalStateBuyingPower} = _.reduce(strategyDetails.positions, (prev, curr) => {
      let brokerId = this.alphaBrokerIndex[curr.id];
      let isLong = math.evaluate('a >= 0', {a: curr.amount});
      let price = ((isLong) ? curr.bid : curr.ask);
      let total = math.evaluate('bignumber(a) * bignumber(b) * bignumber(c)', {
        a: brokerBuyingPower,
        b: curr.percent,
        c: this.multiplier
      }).toString();
      prev.finalState[brokerId] = math.evaluate('bignumber(a) / bignumber(b) * bignumber(c)', {
        a: total,
        b: price,
        c: ((isLong) ? '1' : '-1')
      }).toString();
      prev.finalStateBuyingPower = math.evaluate('bignumber(a) + bignumber(b)', {a: prev.finalStateBuyingPower, b: total}).toString();
      return prev;
    }, {finalState: {}, finalStateBuyingPower: 0});
    
    //calculate new orders to go from current state to final state
    let isPositive = (a) => math.evaluate('bignumber(a) > 0', {a: a});
    let subtract = (a, b) => math.evaluate('bignumber(a) - bignumber(b)', {a: a, b: b}).toString();
    let newOrders = _.union(Object.keys(currentState), Object.keys(finalState)).reduce((prev, curr) => {
      //get values
      let currentAmount = currentState[curr] || 0;
      let finalAmount = finalState[curr] || 0;
      let action = ((math.evaluate('bignumber(a) <= bignumber(b)', {a: currentAmount, b: finalAmount})) ? 'buy' : 'sell')
      let oppositeSigns = math.evaluate('bignumber(a) * bignumber(b) < 0', {a: currentAmount, b: finalAmount});
      
      //close opposite positions and unmatched positions
      if(oppositeSigns || math.evaluate('bignumber(a) != 0 and bignumber(b) == 0', {a: currentAmount, b: finalAmount})) {
        let amount = subtract(0, currentAmount);
        prev.push({
          id: curr,
          type: 'close',
          action: ((math.evaluate('a >= 0', {a: amount})) ? 'buy' : 'sell'),
          amount: math.evaluate('abs(bignumber(a))', {a: amount}).toString()
        });
        currentAmount = 0;
      }
      
      //increase or decrease positions
      let amount = subtract(finalAmount, currentAmount);
      if(math.evaluate('bignumber(a) != 0', {a: amount})) {
        //get price and total
        let quote = prices[curr];
        let price = ((math.evaluate('bignumber(a) >= 0', {a: amount})) ? quote.bid : quote.ask)
        let total = math.evaluate('bignumber(a) * bignumber(b)', {a: amount, b: price}).toString();
        //determine order type
        let type = undefined;
        if(action === 'sell' && isPositive(finalAmount)) type = 'sell_long';
        if(action === 'buy' && !isPositive(finalAmount)) type = 'buy_short';
        if(action === 'buy' && isPositive(finalAmount)) type = 'buy_long';
        if(action === 'sell' && !isPositive(finalAmount)) type = 'sell_short';
        //create new order
        prev.push({
          id: curr,
          type: type,
          action: ((math.evaluate('a >= 0', {a: amount})) ? 'buy' : 'sell'),
          amount: math.evaluate('abs(bignumber(a))', {a: amount}).toString(),
          total: math.evaluate('abs(bignumber(a))', {a: total}).toString(),
          price: price
        });
      }
      //return
      return prev;
    }, []);
    
    //return
    return newOrders;
  }
  
  //CHECK: rebalance
  async rebalance() {
    let rebalancePositions = async () => {
      //cancel all open orders
      await this.Broker.cancelAllOpenOrders();
      
      //calculate new orders
      let newOrders = await this.calculateNewOrders();
      
      //execute new orders
      let orders = await this.executeOrders({orders: newOrders});
      
      //repeat rebalance if flag is set
      if(this.repeatRebalance) {
        this.repeatRebalance = false;
        await rebalancePositions();
      }
    }
    
    //start transaction
    if(this.rebalancing) {
      this.repeatRebalance = true;
      return;
    }
    this.rebalancing = true;
    
    //rebalance
    return rebalancePositions()
    //error, close all orders and positions
    .catch(async (error) => {
      //close all orders and positions
      await this.Broker.cancelAllOpenOrders().catch((error) => {});
      await this.Broker.closeAllPositions().catch((error) => {});
      //propagate error upwards
      throw error;
    })
    //end transaction
    .finally(() => {
      this.rebalancing = false;
      this.repeatRebalance = false;
    });
  }
  
  //CHECK: destroy
  async destroy() {}
}

module.exports = Bot;