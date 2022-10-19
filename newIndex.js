/* ToDo:
    
    *Add conditionalOrders(above/below, triggerPrice, time in minutes) and handling.
    
    *Add server-side support. This "engine" can be used with the front-end. However, the second the front-end stop,
        all the scheduled orders (chaseOrders, twap & conditionalOrders) will stop working.
        In this case, execution must relay in a server-side engine.
    
    
    !!: Most of engine functions needs a ticker in OpenTickers{};
        By default, engine will subscribe to BTC-PERP ticker + pairs with ongoing trades.
        Because of this:
        * Add openTickers handling
            - unsub when position closed;
            - sub if instrument changes (for front-end)

*/



const express = require('express');
const bodyParser  = require('body-parser');
const WebSocket = require('ws');
const wsFTX = 'wss://ftx.com/ws/';
const wsTicker = new WebSocket(wsFTX);
const wsOrders = new WebSocket(wsFTX);
const wsFills = new WebSocket(wsFTX);
const { FTX } = require('./utils/index');
const { changeOrder } = require('./utils/FTX');
const e = require('cors');


const app = express();
const port = 3000;
app.use(bodyParser.json(), bodyParser.urlencoded({extended: false}));

let openTickers = {} // Last Price from openTickers
let subscribedToOrders = false;
let openTrades = {} // Info about openTrades
let notifications = []; //Notis
let ordersToChase = {};
let bestOrders = {};
let twapSchedule = {};

app.listen(port, () => {
    console.log('Connecting to FTX ws.');
});

// --------------- Endpoints for Test ---------------

app.get('/ordersTest', (req, res) => {
    FTX.ordersTest();
    res.send('Ok');
})

app.post('/placeOrder', (req, res) => {
    
    let tag = req.body.tag; //none (limit/market), best, chase;
    let market = req.body.market;
    let side = req.body.side;
    let type = req.body.type;
    let size = parseFloat(req.body.size);
    let price = parseFloat(req.body.price);
    let reduceOnly = JSON.parse(req.body.reduceOnly);
    let postOnly = JSON.parse(req.body.postOnly);
    let clientId = null;

    if (tag === 'none') {
        if(type === 'market') price = null;
        placeOrder(market, side, type, size, price, clientId, reduceOnly, postOnly);
        res.send('normal order received');
    } else {
        let order = {market, side, type, size, price, clientId, reduceOnly, postOnly};
        if (tag === 'best') bestOrder(order);
        else if (tag === 'chase') chaseOrder(order);
        res.send(tag + ' order received');
    }
});

app.get('/spreadTest', (req, res) => {
    FTX.spreadTest();
    res.send('Ok');
})

app.post('/spreadOrders', (req, res) => {

    let market = req.body.market;
    let side = req.body.side;
    let size = parseFloat(req.body.size);
    let orders = parseInt(req.body.orders);
    let high = parseFloat(req.body.high);
    let low = parseFloat(req.body.low);

    spreadOrders(market, side, size, orders, high, low);

})

app.get('/twapTest', (req, res) => {
    FTX.twapTest();
    res.send('Ok');
});

app.post('/startTwap', (req, res) => {
    let market = req.body.market;
    let side = req.body.side;
    let size = parseFloat(req.body.size);
    let orders = parseInt(req.body.orders);
    let time = parseFloat(req.body.time);

    twap(market, side, size, orders, time);
});


// --------------- Web Sockets ---------------

wsOrders.on('open', function open() {
    let logg = FTX.wsAuth();
    wsOrders.send(JSON.stringify(logg));
    let subs = {'op': 'subscribe', 'channel': 'orders'};
    if(!subscribedToOrders) wsOrders.send(JSON.stringify(subs));
});

wsOrders.on('message', function incoming(message) {
    let msgData = JSON.parse(message);
    let data = msgData.data;

    if (msgData.type === 'update') {

        if(data.status === 'new') { //On new orders
            if(data.clientId) {
                handleNewOrder(data);
            } else notifications.push(data.type + 'order placed for ' + data.market); //Push Noti
        
        } else if(data.status === 'closed') { // On closed orders
            if(data.clientId) {
                handleClosedOrder(data);
            } else notifications.push(data.type + ' order closed for ' + data.market);
        }

    } else if(msgData.type === 'subscribed') {
        notifications.push('Subscribed to ' + msgData.channel);
        subscribedToOrders = true;
    } else if(msgData.type === 'unsubscribed') {
        notifications.push('Unsubscribed to ' + msgData.channel);
        subscribedToOrders = false;
    }
});


wsTicker.on('open', async function open() {

    openTrades = await FTX.getPositions(); // get Open trades

    for (const pair in openTrades) { //Iterate em
      let market = openTrades[pair].ticker;
      subscribeToTicker(market); //Subscribe to
    }

    if(!openTickers['BTC-PERP']) subscribeToTicker('BTC-PERP');
    
});

wsTicker.on('message', function incoming(message) {

    let msgData = JSON.parse(message);

    if (msgData.type === 'update') {

        let market = msgData.market;

        if (openTickers[market].last !== msgData.data.last) { // If new lastPrice
            let bestBid;
            let bestAsk;
            
            if(msgData.data.last === msgData.data.bid) {
                bestBid = msgData.data.bid;
                bestAsk = msgData.data.last + openTickers[market].priceIncrement;
            } else {
                bestAsk = msgData.data.ask;
                bestBid = msgData.data.last - openTickers[market].priceIncrement;
            }

            if(openTickers[market].decimals === 0) {
                bestBid = Math.trunc(bestBid);
                bestAsk = Math.trunc(bestAsk)
            } else {
                bestBid = bestBid.toFixed(openTickers[market].decimals);
                bestAsk = bestAsk.toFixed(openTickers[market].decimals);
            }

            openTickers[market] = { ...openTickers[market],
                'last': msgData.data.last,
                'bid': msgData.data.bid,
                'ask': msgData.data.ask,
                bestBid, bestAsk
            }

            if (openTrades[market]) updatePosition(market, openTickers[market].last);
            if (ordersToChase[market] && ordersToChase[market].placed) chaseHandler(market);
            consolePrint();
        };

    } else if (msgData.type !== 'subscribed') { // Solo para imprimir en consola ////
        if (msgData.type === 'error') {
          let noti = 'ERROR: ' + msgData.msg + ' ('+ msgData.code + ')';
          notifications.push(noti);
        } else {
          let noti = 'Tickers: ' + msgData.market + ' type: ' + msgData.type + ', msg:' + msgData.msg + ', code:' + msgData.code;
          notifications.push(noti); // push noti
        }
      }
      
});

wsFills.on('open', function (open) {
    let logg = FTX.wsAuth();
    wsFills.send(JSON.stringify(logg));
    let subs = {'op': 'subscribe', 'channel': 'fills'};
    wsFills.send(JSON.stringify(subs));
});

wsFills.on('message', function incoming(message) {
    let msgData = JSON.parse(message);  
    if (msgData.type === 'update') {
        notifications.push('Order Filled for ' + msgData.data.market + '(' + msgData.data.side + ' ' + msgData.data.size + ' at ' + msgData.data.price + ')');
    } else {
        notifications.push('Channel:' + msgData.channel +  '- type: ' + msgData.type );
    }
});

async function subscribeToTicker(market) {
    let subs = {
        'op': 'subscribe', 
        'channel': 'ticker', 
        'market': market
      };
      let marketData = await FTX.getMarket(market);
      let ask = marketData.result.ask;
      let bid = marketData.result.bid;
      let last = marketData.result.last;
      let priceIncrement = marketData.result.priceIncrement;
      let sizeIncrement = marketData.result.sizeIncrement;
      let minSize = marketData.result.minProvideSize;
      let bestBid, bestAsk;
      let decimals = (getDecimals(priceIncrement));

      if (bid === last) {
          bestBid = bid;
          bestAsk = last + priceIncrement;
      } else {
          bestBid = last - priceIncrement;
          bestAsk = ask;

      }
      wsTicker.send(JSON.stringify(subs)); // Subscribe to every ticker
      openTickers[market] = {last, bid, ask, bestBid, bestAsk, priceIncrement, sizeIncrement, decimals, minSize}; //Add to openTickers{}
}

function unsubToTicker(market) {
    let subs = {
        'op': 'unsubscribe', 
        'channel': 'ticker', 
        'market': market
      };
    
    if (openTickers[market]) delete openTickers[market];
}

function handleNewOrder(data) {
    if(data.clientId.substring(0,4) === 'chas')  { //IF chase order
        ordersToChase[data.market].placed = true;
        ordersToChase[data.market].orderID = data.id; //Refresh id
        ordersToChase[data.market].order.price = data.price; //Refres order price
        ordersToChase[data.market].paused = false; //Unpause to allow handle
    } else if(data.clientId.substring(0,4) === 'best') {
        notifications.push('Limit order placed at best price for ' + data.market); //Push noti
        delete bestOrders[data.market];
    } else { //Normal orders
        notifications.push(data.type + ' order placed for ' + data.market); //Push Noti
    }
}

function handleClosedOrder(data) {
    if(data.clientId.substring(0,4) === 'chas' && ordersToChase[data.market])  { //If chase order
        ordersToChase[data.market].paused = true;
        if(ordersToChase[data.market].placed) { //If placed
            ordersToChase[data.market].placed = false;
            if(data.filledSize === data.size) { // and filled
                notifications.push('Chase order finished');
                delete ordersToChase[data.market];
            }
        } else { //If not placed
            /*Order has been rejected.
            When changeOrder() is executed, order wss will received a closed order for
            the original order and will change placed to false
            If then it receives another "closed" status for chase orde (while placed = false),
            it means order has been rejected
            (Same applies for rejections on placeOrders because placed = false by default)
            */
            ordersToChase[data.market].paused = true;
            notifications.push({
                'price': data.price,
                'bid': openTickers[data.market].bid,
                'ask': openTickers[data.market].ask,
                'last': openTickers[data.market].last
            });
            notifications.push('Chase orders for ' + data.market + ' needs to redeploy.');
            let thisOrder = ordersToChase[data.market].order; //Save order
            delete ordersToChase[data.market]; //
            chaseOrder(thisOrder); //redeploy
        }

    } else if(data.clientId.substring(0,4) === 'best') {
        if(bestOrders[data.market]) { //rejected
            notifications.push('Best order for ' + data.market + 'needs to redeploy.');
            let thisOrder = bestOrders[data.market].order;
            delete bestOrders[data.market];
            bestOrder(thisOrder);
        }
    } 
};

// --------------- Engine Functions ---------------

function consolePrint() {
    console.clear();
    for (const trade in openTrades) { //
        let market = openTrades[trade].ticker;
        let cost = openTrades[trade].cost;
        let avgPrice = openTrades[trade].avgPrice;
        let BEPrice = openTrades[trade].BEPrice;
        let recentPnl = openTrades[trade].recentPnl;
        console.log('Market: ', market, ' - ', cost, ' @ ', avgPrice, ' (BE: ', BEPrice, ')');
        console.log('DAILY TOTAL PNL: ', recentPnl, '(lastPrice: ', openTickers[market].last, ')');
        console.log('=================================');
      }

      console.log('Notificaciones:');
      console.log('');
      notifications.forEach(function(msg){
        console.log(msg);
      });
}

function updatePosition(market, lastPrice) { //market and last price

    let thisPosition = openTrades[market]; // info 'bout trade

    if(thisPosition) {
      if (thisPosition.netSize > 0) { //Long

        let delta = lastPrice - thisPosition.BEPrice;
        let deltaPercentage = delta * 100 / thisPosition.BEPrice;
        let pnl = thisPosition.cost * (deltaPercentage/100);
        pnl = pnl.toFixed(2);
        openTrades[market].recentPnl = pnl + ' USD'; // Refresh PNL
  
      } else if (thisPosition.netSize < 0) { //Short
  
        let delta = thisPosition.BEPrice - lastPrice;
        let deltaPercentage = delta * 100 / thisPosition.BEPrice;
        let pnl = thisPosition.cost * (deltaPercentage/100);
        pnl = pnl * -1;
        pnl = pnl.toFixed(2);
        openTrades[market].recentPnl = pnl + 'USD'; //Refresh PNL
      }
    }
}

//Order Placing

async function placeOrder(market, side, type, size, price = null, clientId = null, reduceOnly = false, postOnly = false) {

    let order = {
        'market': market,
        'side': side,
        'size': size,
        'price': price,
        'type': type,
        'reduceOnly': reduceOnly,
        'postOnly': postOnly,
        'clientId': clientId
      };
      if (price === 'best') {
          if (side === 'buy') order.price = openTickers[market].bestBid;
          else order.price = openTickers[market].bestAsk;
      }
      if(!reduceOnly) delete order.reduceOnly;
    let response = await FTX.placeOrder(order)
    notifications.push(response);
    
}

async function placeTrigger(market, side, size, type, triggerPrice, clientId = null, reduceOnly = null, postOnly = null) {
    
    let order = {
        'market': market,
        'side': side,
        'size': size,
        'triggerPrice': triggerPrice,
        'type': type,
        'reduceOnly': false,
        'ioc': false,
        'postOnly': false,
        'clientId': null
      };
      notifications.push("order" + order);

      let response = await FTX.placeTriggerOrder(order);
      notifications.push(response);
}

//chaseOrders

function chaseOrder(order, chaseTo = null) {
    /*
      ChaseTo should be the price for the engine to stop chasing the price. Must be < order.price if side = sell and vice versa.
      Not implemented yet.
    */

  let clientId = 'chase' + Date.now();
  ordersToChase[order.market] = {clientId, order, chaseTo, 'orderID': 0, 'filled': false, 'paused': false,'placed': false};
  placeOrder(order.market, order.side, 'limit', order.size, 'best', clientId, false, true);
}

function chaseHandler(market) {
    if (!ordersToChase[market].paused) {
        ordersToChase[market].paused = true;
        let bestPrice;
        if(ordersToChase[market].order.side === 'buy') bestPrice = openTickers[market].bestBid;
        else bestPrice = openTickers[market].bestAsk;
        if(ordersToChase[market].order.price !== bestPrice) {
            let clientId = 'chase' + Date.now();
            changeOrder(ordersToChase[market].orderID, {'price': bestPrice, clientId});
        } else ordersToChase[market].paused = false;
    }
};
//bestOrder()

function  bestOrder(order) {
    let clientId = 'best' + Date.now();
    bestOrders[order.market] = {'type': 'best', clientId, order};
    placeOrder(order.market, order.side, 'limit', order.size, 'best', clientId, false, true);
}

//twap

function twap(market, side, size, orders, time) {

    let inMS = time * 60000;
    console.log(inMS);

    let order_size = size / orders;
    order_size = order_size.toFixed(openTickers[market].decimals);
    let interval = inMS / orders;
    console.log('interval>>' + interval);

    //let marketData = await FTX.getMarket(market); //Not really necessary cause if subscribed to ticker, this info will be already in openTickers[market].sizeIncrement

    if (order_size < openTickers[market].sizeIncrement) {
        notifications.push('Cant split that size in that many orders (order_size < market.min_size');
        return 0;
    }

    twapSchedule[market] = {side, size, orders, order_size, interval, 'ordersExec': 0, 'size_filled': 0, 'lastTS': 0};
    notifications.push('Twap for ' + market + 'has started');
    let timer = setInterval(() => twapHandler(), 1000);
    twapSchedule[market].timer = timer;
    console.log('Twap function finished');
    console.log(twapSchedule[market]);
}

function twapHandler() {
    console.log('handler runing')

    
    if (Object.keys(twapSchedule).length) {
        console.log('Theres a twap')
        for (const market in twapSchedule) {
            console.log('inside ' + market)
            let ts = Date.now();
            let interval = twapSchedule[market].interval;
            let lastTS = twapSchedule[market].lastTS;

            if (lastTS + interval <= ts) {
                placeOrder(market, twapSchedule[market].side, 'market', twapSchedule[market].order_size);
                twapSchedule[market].lastTS = ts;
                twapSchedule[market].ordersExec++
                twapSchedule[market].size_filled += twapSchedule[market].order_size;

                if (twapSchedule[market].ordersExec === twapSchedule[market].orders) {
                    clearInterval(twapSchedule[market].timer)
                    notifications.push('TWAP finished for ', market);
                    delete twapSchedule[market];
                }

            }
        }
    }
}

//spreadOrders

async function spreadOrders(market, side, size, orders, high, low, average = null) {

    // require openTickers[market]

    if (!average) {
        let spread = high - low;
        let priceSpread = spread / (orders - 1);
        let orderSize = size / orders;
        let price = low - priceSpread;

        if (orderSize < openTickers[market].minSize) {
            notifications.push('Cant split that size in that many orders (order_size < market.min_size');
            return 0;
        }

        //toDo: Handle priceIncrement and use .toFixed() for dynamic orderPrice;

        for (let x = 0 ; x < orders ; x++) {
            price += priceSpread;
            await sleep(150); // THIS should be handled by placeOrder() and placeTrigger instead, so thread is not paused.
            if ((side === 'buy' && price < openTickers[market].last) || (side === 'sell' && price > openTickers[market].last)) placeOrder(market, side, 'limit', orderSize, price);
            else placeTrigger(market, side, orderSize, 'stop', triggerPrice = price);
        }
        notifications.push('Completed spread:' + side, ' orders for ' + market);


    } else {
        /* Para average !== null, la ditribución tendría que cambiar tal que, si todas las ordenes se llenan, averageEntryPrice = average.

        Para !average, tenemos una distribución uniforme. Lo que hacemos entonces es dividir el size entre el número de ordenes dentro del spread.
        Ni más, ni menos. Por lo tanto, el average siempre será mas o menos igual a high - delta/2 
            (Porque si bien la distribucion de las ordenes es uniforme, la ejecucion o 
                    la forma en la que se llenan pueden no serlo si hay ordenes stop-market involucradas)

        Cuando existe un average, la distribucion y el sizing de las ordenes debe cambiar, tal que si todas las ordenes se llenan, averageEntryPrice = average.
        */
    }
}

// ! ----- Utils -------

/* ! --- about sleep --- !

    Impractical solution cause it pause the entire thread (JS is single-threaded, so... 
        Better to delegate the ratelimit handling to somewhere else when in Production.)
*/

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function getDecimals(value) {
    if (Math.floor(value) !== value) return value.toString().split('.')[1].length || 0;
    else return 0;
};