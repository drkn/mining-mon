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
  },
  statusMessage () {
    switch (this.valid) {
      case undefined:
        return 'N/A'
      case 0:
        return ` ${this.statusText()} (${utils.convert.toElapsed(Date.now() / 1000 - this.lastValidTime)}) `
      default:
        return this.statusText()
    }
  }
}

const watchdog = {
  status: {
    status: WatchdogStatus.NEW,
    lastUpdate: Date.now() / 1000,
    watches: []
  },

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
      interval: app.config.watchdog_shares_interval || app.config.watchdog_interval,
      tick (online, minerStatus) {
        // Push accepted shares
        this.data.push({
          ts: this.now,
          accepted_shares: minerStatus.mining.map(curr => curr.accepted_shares) // array of number of accepted shares for every coin
        })
        this.data = this.data.filter(item => {
          return item.ts > this.now - this.interval
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
    }),
    Object.assign({}, Watch, {
      name: 'GPU shares',
      interval: parseInt(app.config.watchdog_gpu_shares_interval) || parseInt(app.config.watchdog_interval),
      restartMiner: utils.config.isTrue(app.config.watchdog_gpu_shares_restart),
      data: [],
      tick (online, minerStatus) {
        this.data.push({
          ts: this.now,
          shares: minerStatus.mining.map(curr => {
            return curr.gpu_accepted_shares.map((accepted, idx) => accepted - (curr.gpu_invalid_shares[idx] || 0) - (curr.gpu_rejected_shares[idx] || 0))
          })
        })
        this.data = this.data.filter(item => {
          return item.ts > this.now - this.interval
        })
        this.diff = this.sharesDiff()
        if (this.diff === undefined) {
          this.valid = undefined
        } else {
          this.valid = this.diff.shares.every(val => val.every(diff => diff > 0))
        }
      },
      statusText () {
        if (this.valid === undefined) {
          return 'N/A'
        }
        let inLast = utils.convert.toElapsed(this.data[this.data.length - 1].ts - this.data[0].ts)
        let dump = this.diff.shares.map(curr => curr.join(',')).join(' - ')

        if (this.valid) {
          return `INCREASING (${dump} in last ${inLast})`
        }
        if (this.diff.shares.every(curr => curr.every(diff => diff === 0))) {
          return `STALE in last ${inLast} (max ${utils.convert.toElapsed(this.interval)})`
        }
        if (this.diff.shares.some(curr => curr.some(diff => diff < 0))) {
          return `INVALID (${dump}) in last ${inLast} (max ${utils.convert.toElapsed(this.interval)})`
        }
        return `SOME STALE (${dump}) in last ${inLast} (max ${utils.convert.toElapsed(this.interval)})`
      },
      sharesDiff () { // Get shares diff
        if (this.data.length === 0) {
          return undefined
        } else {
          let firstData = this.data[0]
          let lastData = this.data[this.data.length - 1]
          let diff = {
            ts: lastData.ts - firstData.ts,
            shares: []
          }
          for (let curr = 0; curr < firstData.shares.length; curr++) {
            diff.shares.push(
              lastData.shares[curr].map((share, idx) => share - firstData.shares[curr][idx])
            )
          }
          return diff // {"ts":9163,"shares":[[0,0,0,0,1,2,0,0]]}
        }
      }
    })
  ],

  start () {
    this.status.status = WatchdogStatus.SLEEPING
    setTimeout(this.run.bind(this), app.config.watchdog_delay * 1000)
  },

  run () {
    this.watches.forEach(watch => {
      watch.reset()
    })
    this.status.status = WatchdogStatus.RUNNING
  },

  restart () {
    this.status.status = WatchdogStatus.RESTARTING
    this.watches.forEach(watch => {
      watch.restart()
    })
    miner.restart(true)
    setTimeout(this.run.bind(this), app.config.watchdog_delay * 1000)
  },

  tick (online, minerStatus) {
    // this.online = online
    let now = parseInt(Date.now() / 1000)
    this.status.lastUpdate = now
    if (this.status.status === WatchdogStatus.RUNNING) {
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
              log.warn(`Watchdog:${watch.name} - invalid state - ${watch.statusText()}`)
            }
            if (lastValid === false && watch.valid) {
              log.info(`Watchdog:${watch.name} - came back to normal - ${watch.statusText()} after ${now - watch.lastValidTime}s`)
            }
          }
          watch.lastValidTime = watch.valid || watch.lastValidTime === undefined ? now : watch.lastValidTime
          if (!watch.valid && watch.now - watch.lastValidTime > watch.interval) {
            if (watch.restartMiner) {
              log.error(`Watchdog:${watch.name} - restarting miner due to too long invalid state (${watch.interval}s). Watch status: ${watch.status}`)
              this.restart()
            } else {
              log.error(`Watchdog:${watch.name} - to too long invalid state (${watch.interval}s). Watch status: ${watch.status}`)
              watch.reset()
            }
          }
          chainBroken = restart || (!watch.valid && watch.breakChain)
        }
      })
    }
    this.status.watches = this.watches.map(watch => {
      return {
        name: watch.name,
        valid: watch.valid === undefined ? -1 : (watch.valid ? 1 : 0),
        lastValidTime: watch.lastValidTime || -1,
        interval: watch.interval,
        restartMiner: watch.restartMiner,
        status: watch.statusMessage()
      }
    })
  },

  drawStatus (buff) {
    new clui.Line(buff).column(`Watchdog ${this.status.status}. `).store()
    this.status.watches.forEach(watch => {
      let status = ''
      switch (watch.valid) {
        case -1:
          status = clc.yellow(watch.status)
          break
        case 0:
          status = clc.bgRed.white(watch.status)
          break
        default:
          status = clc.green(watch.status)
      }
      new clui.Line(buff)
        .column(`${watch.restartMiner?'r+ ':'   '}${watch.name}: `, 20)
        .column(status)
        .store()
    })
  }

}

module.exports = watchdog
