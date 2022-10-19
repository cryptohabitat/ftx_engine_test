const crypto = require('crypto');
const axios = require('axios');
const baseUrl = 'https://ftx.com';
const apiPrefix = '/api';

const dotenv = require('dotenv');

dotenv.config()

const FTX_KEY = process.env.API_KEY;
const FTX_SECRET = process.env.API_SECRET;
const FTX_SUB = process.env.API_SUB;

function getUrl(path) {
  let url = baseUrl + apiPrefix + path
  url = url.toString();
  return url
}


function getHeaders(method, path, data = null, subaccount = null) {

    let ts = Date.now() + 1000;
    let endpoint = apiPrefix + path;

    const payload = data ? JSON.stringify(data): '';
    const concat = ts + method + endpoint + payload;

    const signature = crypto
      .createHmac('sha256', FTX_SECRET)
      .update(concat)
      .digest('hex');
    
    let headers = {
        'Content-Type': 'application/json',
        'FTX-KEY': FTX_KEY,
        'FTX-SIGN': signature,
        'FTX-TS': ts.toString()
    }
    if (FTX_SUB) headers['FTX-SUBACCOUNT'] = subaccount;

    return headers;
  }


function wsAuth() {
    let ts = Date.now() + 1000;
    const signature = crypto
    .createHmac('sha256', FTX_SECRET)
    .update(ts + 'websocket_login')
    .digest('hex');

    let subs = {
        "args": {
          "key": FTX_KEY,
          "sign": signature,
          "time": ts
        },
        "op": "login"
      };

      if (FTX_SUB) subs.subaccount = API_SUB;

      return subs
}

async function getMarket(market) {
  let endpoint = '/markets/' + market;
  let headers = getHeaders('GET', endpoint);
  let url = getUrl(endpoint);

  try {
      
      const response = await axios.get(url, { headers });
      return response.data

  } catch (error) {
      console.log(error.response.data);
  }

}

async function getOrders() {
  let endpoint = '/orders';
  let headers = getHeaders('GET', endpoint);
  let url = getUrl(endpoint);

  try {
      
      const response = await axios.get(url, { headers });
      return response.data

  } catch (error) {
      console.log(error.response.data);
  }

}

async function getPositions() {
  let endpoint = '/positions?showAvgPrice=true';
  let headers = getHeaders('GET', endpoint,'', FTX_SUB);
  let url = getUrl(endpoint);

  try {

    let response = await axios.get(url, {headers});
    response = response.data;

  
    let finalPositions = {};

    if (response.success) {
      let result = response.result;

      result.forEach(function(position) {
        if (position.size !== 0) {
          let market = position.future;
          let side = position.side;
          let netSize = position.netSize;
          let cost = position.cost;
          let avgPrice = position.recentAverageOpenPrice;
          let BEPrice = position.recentBreakEvenPrice;
          let recentPnl = position.recentPnl;
          let thisTrade = {'ticker': market, side, netSize, cost, avgPrice, BEPrice, recentPnl};
          finalPositions[market] = thisTrade;
        }
      })

      return finalPositions;

      } else return {'success': false};
    
  } catch(error) {
    console.log(error);
  }
}

async function placeOrder(order) {


  let endpoint = '/orders';
  let headers = getHeaders('POST', endpoint, order, FTX_SUB);
  let url = getUrl(endpoint);

  try {
    const response = await axios.post(url, order, {headers: headers});
    let noti = response.data.result.market + ' - ' + order.size + ' ' + response.data.result.type + ' order sent (ID: ' + response.data.result.id + ')';
    return {'status': 200, 'orderID': response.data.result.id, 'msg': noti};

  } catch(error) {
      if(error.response) {
        let noti = order.market + ' - ' + order.side + ' ' + order.type + ' order error (' + error.response.data.error + ')'; 
        return {'status': 400, 'msg': noti};
      }
  }
}

async function placeTriggerOrder(order) {

  /*let order = {
    "market": "AXS-PERP",
    "side": "buy",
    "size": 1,
    "triggerPrice": 150,
    "type": "stop",
    "reduceOnly": true,
  }*/

  let endpoint = '/conditional_orders';
  let headers = getHeaders('POST', endpoint, order, FTX_SUB);
  let url = getUrl(endpoint);

  try {
    const response = await axios.post(url, order, {headers: headers});
    let noti = response.data.result.market + ' - ' + order.size + ' ' + response.data.result.type + ' order success (ID: ' + response.data.result.id + ')';
    console.log(noti);
    return {'status': 200, 'orderID': response.data.result.id, 'msg': noti };

  } catch(error) {
      if(error.response) {
        let noti = order.market + ' - ' + order.side + ' ' + order.type + ' order error (' + error.response.data.error + ')'; 
        console.log(noti)
        return {'status': 400, 'msg': noti};
      }
  }
}

async function changeOrder(orderID, order) {

  //let orderID = 95181690010;

  /*let order = {
    'price': 132,
    'size': null
  };*/

  let endpoint = '/orders/' + orderID + '/modify';
  let headers = getHeaders('POST', endpoint, order, FTX_SUB);
  let url = getUrl(endpoint);

  try {
    const response = await axios.post(url, order, {headers: headers});
    let noti = response.data.result.market + ' - Order ' + orderID + ' has been modified (size: ' + order.size + ', price: ' + order.price + '. newID: ' + response.data.result.id + ')';
    return {'status': 200, 'orderID': response.data.result.id, 'msg': noti };

  } catch(error) {
      if(error.response) {
        console.log('error>>>>>>', error.response.data);
        let noti =  'Error modifying order ' + orderID + ' (' + error.response.data.error + ')'; 
        return {'status': 400, 'msg': noti};
      }
  }

}

async function changeTriggerOrder(orderID, order) {

  let endpoint = '/conditional_orders/' + orderID + '/modify';
  let headers = getHeaders('POST', endpoint, order, FTX_SUB);
  let url = getUrl(endpoint);

  try {
    const response = await axios.post(url, order, {headers: headers});
    let noti = response.data.result.market + ' - Order ' + orderID + ' has been modified (newID: ' + response.data.result.id + ')';
    return {'status': 200, 'orderID': response.data.result.id, 'msg': noti };

  } catch(error) {
      if(error.response) {
        let noti =  'Error modifying order ' + orderID + ' (' + error.response.data.error + ')'; 
        return {'status': 400, 'msg': noti};
      }
  }

}

// ! --- Test Functions --- !

function ordersTest() {
  let body = {
    "tag": "chase",
    "market": "ETH-PERP",
    "side": "buy",
    "type": "market",
    "size": "0.01",
    "price": "4800",
    "reduceOnly": "false",
    "postOnly": "false"
  }
  let headers = {'Content-Type': 'application/json'};
  axios.post('http://localhost:3000/placeOrder', body, {headers: headers});
}

function spreadTest() {
  let body = {
    "market": "ETH-PERP",
    "side": "sell",
    "size": "1",
    "orders": "10",
    "high": "4800",
    "low": "3800"
  }
  let headers = {'Content-Type': 'application/json'};

  axios.post('http://localhost:3000/spreadOrders', body, {headers: headers});
}

function twapTest() {
    let body = {
      "market": "ETH-PERP",
      "side": "sell",
      "size": "1",
      "orders": "12",
      "time": "1"
    }
    let headers = {'Content-Type': 'application/json'};
    axios.post('http://localhost:3000/startTwap', body, {headers: headers});
}

module.exports = {wsAuth, getPositions, placeOrder, changeOrder, getMarket, placeTriggerOrder, ordersTest, spreadTest, twapTest};