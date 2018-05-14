const app = require('./app')
const clc = require('cli-color')
const clui = require('clui')
const miner = require('./miner')
const utils = require('./utils')
const log = require('./log')

const WatchdogStatus = Object.freeze({
  NEW: 'new',
  SLEEPING: 'sleeping',
  RUNNING: 'running',
  RESTARTING: 'restarting'
})

let Watch = {
  name: undefined,
  interval: app.config.watchdog_interval, // Default watchdog interval
  valid: undefined,
  lastValidTime: undefined,
  breakChain: false, // Break watch chain if error state is detected
  logChanges: true, // Log every state change
  restartMiner: true, // Restart miner if error state lasts longer than ${this.interval} seconds
  data: [], // Additional watch data
  tick (online, minerStatus) {},
  reset () {
    this.lastValidTime = undefined
    this.valid = undefined
  },
  restart () {
    this.reset()
    this.data = []
  },
  statusText () {
    return this.valid ? 'VALID' : 'INVALID'
  }
}

const watchdog = {
  status: WatchdogStatus.NEW,

  watches: [
    Object.assign({}, Watch, {
      name: 'Network',
      breakChain: true,
      restartMiner: false,
      statusText () {
        return this.valid ? 'ONLINE' : 'OFFLINE'
      },
      tick (online) {
        this.valid = online
      }
    }),
    Object.assign({}, Watch, {
      name: 'Miner',
      breakChain: true,
      statusText () {
        return this.valid ? 'ONLINE' : 'OFFLINE'
      },
      tick (online, minerStatus) {
        this.valid = !(!minerStatus || Object.keys(minerStatus).length === 0 || minerStatus.miner_online === false || minerStatus.mining.length === 0)
      }
    }),
    Object.assign({}, Watch, {
      name: 'Shares',
      interval: app.config.watchdog_interval * 2, // We want to monitor share increase a little longer
      data: [],

      tick (online, minerStatus) {
        // Push accepted shares
        this.data.push({
          ts: this.now,
          accepted_shares: minerStatus.mining.map(curr => curr.accepted_shares) // array of number of accepted shares for every coin
        })
        // Remove data older than ${watchdog_interval} * 2 (to give watchdog opportunity to act, or false negatives on temporary miner downtime)
        this.data = this.data.filter(item => {
          return item.ts > this.now - (this.interval * 2)
        })
        let sharesDiff = this.sharesIncrease()
        this.valid = sharesDiff === undefined || sharesDiff.accepted_shares.every(val => val > 0)
      },
      statusText () {
        let diff = this.sharesIncrease()
        return (this.valid ? 'INCREASING' : 'STALE') + (diff !== undefined ? (` (${diff.accepted_shares.join(',')} in last ${utils.convert.toElapsed(this.interval)})`) : '')
      },
      sharesIncrease () { // Get shares increase
        if (this.data.length === 0) {
          return undefined
        } else {
          let firstData = this.data[0]
          let lastData = this.data[this.data.length - 1]
          let diff = {
            ts: lastData.ts - firstData.ts,
            accepted_shares: []
          }
          for (let i = 0; i < firstData.accepted_shares.length; i++) {
            diff.accepted_shares.push(lastData.accepted_shares[i] - firstData.accepted_shares[i])
          }
          return diff // {"ts":9163,"accepted_shares":[2]}
        }
      }
    })
  ],

  start () {
    this.status = WatchdogStatus.SLEEPING
    setTimeout(this.run.bind(this), app.config.watchdog_delay * 1000)
  },

  run () {
    this.watches.forEach(watch => {
      watch.reset()
    })
    this.status = WatchdogStatus.RUNNING
  },

  restart () {
    this.status = WatchdogStatus.RESTARTING
    this.watches.forEach(watch => {
      watch.restart()
    })
    miner.restart()
    setTimeout(this.run.bind(this), app.config.watchdog_delay * 1000)
  },

  tick (online, minerStatus) {
    // this.online = online
    let now = parseInt(Date.now() / 1000)
    if (this.status === WatchdogStatus.RUNNING) {
      let chainBroken = false
      let restart = false
      this.watches.forEach(watch => {
        if (chainBroken) {
          watch.reset()
        } else {
          watch.now = now
          let lastValid = watch.valid
          watch.tick(online, minerStatus)
          if (watch.logChanges) {
            if (lastValid && !watch.valid) {
              log.warn(`Watchdog: ${watch.name} invalid state - ${watch.statusText()}`)
            }
            if (lastValid === false && watch.valid) {
              log.info(`Watchdog: ${watch.name} came back to normal - ${watch.statusText()} after ${now - watch.lastValidTime}s`)
            }
          }
          watch.lastValidTime = watch.valid || watch.lastValidTime === undefined ? now : watch.lastValidTime
          if (watch.restartMiner && !watch.valid && watch.now - watch.lastValidTime > watch.interval) {
            log.error(`Watchdog: Restarting miner due to too long invalid state for watch ${watch.name}`)
            this.restart()
          }
          chainBroken = restart || (!watch.valid && watch.breakChain)
        }
      })
    }
  },

  drawStatus (buff) {
    let now = parseInt(Date.now() / 1000)
    let line = new clui.Line(buff).column(`Watchdog ${this.status}. `)
    this.watches.forEach(watch => {
      let statusText = ''
      if (watch.valid === undefined) {
        statusText = clc.yellow('N/A')
      } else if (!watch.valid) {
        statusText = clc.bgRed.white(` ${watch.statusText()} (${utils.convert.toElapsed(now - watch.lastValidTime)}) `)
      } else {
        statusText = clc.green(watch.statusText())
      }
      line.column(watch.name + ' ' + statusText + ' ')
    })
    line.store()
  }

}

module.exports = watchdog
