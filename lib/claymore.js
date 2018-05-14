const net = require('net')
const app = require('./app')

// TODO Support for dual mining

/*
{ result:
   0 [ '11.5 - ETH', // version
   1  '5380', // running time
   2  '258854;20568;0', // hashrate MH/s, shares, rejected shares

   3  '32375;32344;32356;32359;32326;32378;32375;32338', // hasrate / gpu
   4  '0;0;0', // dcr hasrate, dcr shares, dcr rejected shares
   5  'off;off;off;off;off;off;off;off', // dcr hashrate
   6  '64;51;61;47;57;42;50;39;62;49;61;47;62;49;65;53', // temperatures
   7  'eu2.ethermine.org:4444', // pool
   8  '0;0;0;0', // eth invalid shares, eth pool switches, dcr invalid shares, dcr pool switches
   9  '2615;2543;2541;2646;2496;2600;2575;2552', // eth accepted shares
   10  '0;0;0;0;0;0;0;0', // eth rejected shares
   11  '0;0;0;0;0;0;0;0', // eth invalid shares
   12  '0;0;0;0;0;0;0;0', // dcr accepted shares
   13  '0;0;0;0;0;0;0;0', // dcr rejected
   14  '0;0;0;0;0;0;0;0' ], // dcr invalid
  id: 0,
  error: null }
 */

function status () {
  return new Promise((resolve) => {
    let response = []
    let client = new net.Socket()
    client.setTimeout(1000, () => client.destroy())
    client.connect(3333, 'localhost', () => {
      client.write('{"id":0,"jsonrpc":"2.0","method":"miner_getstat2"}')
    })
    client.on('error', (err) => {
      log.warn('Miner status error ', err)
    })
    client.on('data', function (data) {
      response = JSON.parse(data).result
      client.destroy()
    })
    client.on('close', function () {
      let status = {
        miner_online: false,
        mining: []
      }
      if (response.length > 0) {
        status = {
          uptime: parseInt(response[1]) * 60,
          miner_online: true,
          mining: [{
            currency: 'ETH',
            hashrate: response[2].split(';')[0] * 1000,
            accepted_shares: parseInt(response[2].split(';')[1]),
            rejected_shares: parseInt(response[2].split(';')[2]),
            invalid_shares: parseInt(response[8].split(';')[0]),
            pool: response[7].split(';')[0],
            gpu_hashrates: response[3].split(';').map(hashrate => hashrate * 1000),
            gpu_accepted_shares: response[9].split(';').map(shares => parseInt(shares)),
            gpu_rejected_shares: response[10].split(';').map(shares => parseInt(shares)),
            gpu_invalid_shares: response[11].split(';').map(shares => parseInt(shares))
          }]
        }
        // Second coin
        if (response[7].split(';').length === 2) {
          let currencyMatch = app.config.miner_args.match(/-dcoin ([a-zA-Z]+)/)
          status.mining.push({
            currency: currencyMatch.length === 2 ? currencyMatch[1].toUpperCase() : '???',
            hashrate: response[4].split(';')[0] * 1000,
            accepted_shares: parseInt(response[4].split(';')[1]),
            rejected_shares: parseInt(response[4].split(';')[2]),
            invalid_shares: parseInt(response[8].split(';')[2]),
            pool: response[7].split(';')[1],
            gpu_hashrates: response[5].split(';').map(hashrate => hashrate * 1000),
            gpu_accepted_shares: response[12].split(';').map(shares => parseInt(shares)),
            gpu_rejected_shares: response[13].split(';').map(shares => parseInt(shares)),
            gpu_invalid_shares: response[14].split(';').map(shares => parseInt(shares))
          })
        }
      }
      resolve(status)
    })
  })
}

module.exports = {
  status
}
