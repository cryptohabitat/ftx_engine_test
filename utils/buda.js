const crypto = require('crypto');
const axios = require('axios');
const BUDA_KEY = 'd036d1f8d06cd6a66c1197525422c0e8';
const BUDA_SECRET = 'R7LDwL15//hfAf+Yfymcdh1nVocrAmIgbAzcC48p'
const buda_url = 'https://buda.com'
const buda_path = '/api/v2';

function getHeaders(method, path, data = null) {

    let ts = Date.now() + 1000;

    let endpoint = buda_path + path;

    const payload = data ? JSON.stringify(data): '';

    let concat;

    if (!data) concat = method + ' ' + endpoint + ' ' + payload.toString('base64')  + ts;
    else concat = method + ' ' + endpoint + ' ' + payload.toString('base64') + ' ' + ts;
    console.log(concat);

    const signature = crypto
        .createHash('sha384', BUDA_SECRET)
        .update(concat)
        .digest('hex')

    let headers = {
        'X-SBTC-APIKEY': BUDA_KEY,
        'X-SBT-NONCE': ts,
        'X-SBT-SIGNATURE': signature
    }

    return headers;
  }

async function getOrders() {
    let url = 'https://buda.com/api/v2/markets/btc-clp/orders';
    let path = '/markets/btc-clp/orders';
    let headers = getHeaders('GET', path);

    try {
        const response = await axios.get(url, auth = headers, { headers });
        console.log(response.data);

    } catch (error) {
        console.log(error.response.data);
    }

}

async function getWith() {
    let target_address = '1NGdtqrfobpckqpbokmVRbGRxAZwGxcgxW';
    let amount = 0.01;
    let simulate = true;
    let amount_includes_fee = false;
    let path = '/currencies/btc/withdrawals';
    let url = buda_url + buda_path + path;

    let data = {amount, simulate, amount_includes_fee, 'withdrawal_data': {target_address}};
    let headers = getHeaders('POST', path, data);

    try {
        const response = await axios.post(url, auth = headers, json = data, { headers });
        console.log(response.data);

    } catch (error) {
        console.log(error);
    }

}

getOrders();