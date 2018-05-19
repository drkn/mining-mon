const utils = require('./utils')
const app = require('./app')
const clc = require('cli-color')
const log = require('./log')

let kill = function () {
  if (!app.config.miner_debug) {
    utils.process.spawn('taskkill /F /FI "WINDOWTITLE eq mining-mon-miner*"', false)
  }
}

let status = function () {
  let miner = require('./' + app.config.miner_name)
  return miner.status()
}

let start = function (silent = false) {
  kill()
  if (!silent) {
    log.notice(`Starting miner ${app.config.miner_name} v${app.config.miner_version} in ${app.config.miner_delay}s...`)
  }
  setTimeout(() => {
    startMiner()
  }, app.config.miner_debug ? 0 : app.config.miner_delay * 1000)
}

let restart = function () {
  start()
}

let startMiner = function () {
  let cmd = `start "mining-mon-miner ${app.config.miner_name} ${app.config.miner_version}" ${app.config.miner_binary} ${app.config.miner_args}`
  if (app.config.miner_debug) {
    log.info(clc.yellow('Debug mode. Skipping start. Command:'))
    log.info(clc.yellow(`${cmd}`))
  } else {
    setTimeout(() => {
      utils.process.spawn(cmd)
    }, 500)
  }
}

module.exports = {
  start, status, restart
}
