const app = require('./app')
const utils = require('./utils')
const clc = require('cli-color')
const clui = require('clui')
const path = require('path')
const xml2js = require('xml2js')
const miner = require('./miner')
const watchdog = require('./watchdog')
const log = require('./log')

let status = {}
let statusUpdateCount = 0

function inum (value) {
  return parseInt(value.replace(/[^\d.]*/g, ''))
}

function fnum (value) {
  return parseFloat(value.replace(/[^\d.]*/g, ''))
}

function stateLevel (gpuinfo, type) {
  if (app.config.hasOwnProperty('monitor_' + type + '_max')) {
    return stateLevelMax(gpuinfo[type],
      app.config['monitor_' + type + '_warn'],
      app.config['monitor_' + type + '_max'])
  } else {
    return stateLevelMin(gpuinfo[type],
      app.config['monitor_' + type + '_warn'],
      app.config['monitor_' + type + '_min'])
  }
}

function stateLevelMax (value, warn, max) {
  if (value >= max) {
    return 'error'
  } else if (value >= warn) {
    return 'warn'
  } else {
    return 'ok'
  }
}

function stateLevelMin (value, warn, min) {
  if (value <= min) {
    return 'error'
  } else if (value <= warn) {
    return 'warn'
  } else {
    return 'ok'
  }
}

function stateColor (notifLevel) {
  switch (notifLevel) {
    case 'error':
      return [clc.bgRed.white]
    case 'warn':
      return [clc.bgYellow.black]
    default:
      return []
  }
}

function updateStatus () {
  // Read status
  // Promise.all([utils.process.read('cat tmp/smi.xml'), utils.net.online(), miner.status()])
  Promise.all([utils.process.read(app.config.smi_path + ' -q -x'), utils.net.online(), miner.status()])
    .then(([smi, online, minerStatus]) => {
      if (statusUpdateCount % app.config.watchdog_tick === 0) {
        watchdog.tick(online, minerStatus)
      }
      statusUpdateCount++
      xml2js.parseString(smi, {
        trim: true
      }, (err, smijs) => {
        if (err) {
          log.warn('Error parsing smi xml response')
        }
        smijs = smijs.nvidia_smi_log
        status = Object.assign({}, {
          app_version: app.version,
          start: new Date(app.startTs).getTime(),
          worker_name: app.config.worker_name,
          update: new Date().getTime(),
          uptime: 0,
          online: online,
          miner_name: app.config.miner_name,
          miner_version: app.config.miner_version,
          miner_online: false,
          driver_version: smijs.driver_version[0],
          gpu_count: parseInt(smijs.attached_gpus[0]),
          config: app.config,
          gpus: []
        }, minerStatus)
        if (!status.uptime) {
          status.uptime = Math.floor((status.update - status.start) / 1000)
        }
        // Setup mining hashrate statuses
        status.mining.forEach(currency => {
          currency.gpu_hashrates_state = currency.gpu_hashrates.map((hashrate, index) => {
            return stateLevelMin(
              app.normalizeHashrate(currency.currency, hashrate),
              app.config[`monitor_hashrate_${currency.currency.toLowerCase()}_${index}_warn`] ||
              app.config[`monitor_hashrate_${currency.currency.toLowerCase()}_warn`],
              app.config[`monitor_hashrate_${currency.currency.toLowerCase()}_${index}_min`] ||
              app.config[`monitor_hashrate_${currency.currency.toLowerCase()}_min`]
            )
          })
        })

        // Setup per GPU info
        let gpuid = 0
        let gpus = []
        smijs.gpu.forEach(gpu => {
          // Setup info
          let gpuinfo = Object.assign(
            {
              id: gpuid,
              product: gpu.product_name[0].replace('GeForce ', '').replace(/ /g, '').toLowerCase(),
              fan: inum(gpu.fan_speed[0]), // remove "%"
              temp: inum(gpu.temperature[0].gpu_temp[0]),
              power_state: gpu.power_readings[0].power_state[0],
              power: fnum(gpu.power_readings[0].power_draw[0]),
              power_limit: fnum(gpu.power_readings[0].power_limit[0]),
              power_limit_default: fnum(gpu.power_readings[0].default_power_limit[0]),
              gpu_clock: inum(gpu.clocks[0].graphics_clock[0]),
              gpu_clock_max: inum(gpu.max_clocks[0].graphics_clock[0]),
              sm_clock: inum(gpu.clocks[0].sm_clock[0]),
              sm_clock_max: inum(gpu.max_clocks[0].sm_clock[0]),
              mem_clock: inum(gpu.clocks[0].mem_clock[0]),
              mem_clock_max: inum(gpu.max_clocks[0].mem_clock[0]),
              video_clock: inum(gpu.clocks[0].video_clock[0]),
              video_clock_max: inum(gpu.max_clocks[0].video_clock[0])
            },
            status.gpus && status.gpus[gpuid] ? status.gpus[gpuid] : {}
          )
          // Setup OC status
          gpuinfo = Object.assign(gpuinfo, {
            oc_power_limit: gpuinfo.power_limit !== gpuinfo.power_limit_default,
            oc_gpu_clock: gpuinfo.gpu_clock > gpuinfo.gpu_clock_max,
            oc_sm_clock: gpuinfo.sm_clock > gpuinfo.sm_clock_max,
            oc_mem_clock: gpuinfo.mem_clock > gpuinfo.mem_clock_max,
            oc_video_clock: gpuinfo.video_clock > gpuinfo.video_clock_max
          });

          // Setup warnings and errors
          ['fan', 'temp', 'power'].forEach(element => {
            gpuinfo['state_' + element] = stateLevel(gpuinfo, element)
          })
          gpus.push(gpuinfo)
          gpuid++
        })
        status.gpus = gpus
        status.watchdog = watchdog.status

        // Draw status and update again
        setTimeout(() => saveStatus(status))
        setTimeout(() => saveRigState(status))
        setTimeout(() => drawStatus(status))
        setTimeout(updateStatus, app.config.monitor_interval * 1000)
      })
    })
    .catch(error => {
      log.warn('Could not read status', error)
      setTimeout(updateStatus, app.config.monitor_interval * 1000)
    })
}

function saveStatus (status) {
  utils.file.write(path.join(app.dir.run, 'status.json'), JSON.stringify(status, null, 2))
}

function saveRigState (status) {
  const state = {
    rig_id: status.worker_name,
    uptime: status.uptime,
    last_update: '' + parseInt(status.update / 1000),
    gpus_installed: status.gpu_count,
    gpus_in_use: status.gpu_count,
    driver_version: status.driver_version,
    mining_software: `${status.miner_name} ${status.miner_version}`,
    mined_coins: status.mining.map(curr => {
      return {
        coin: curr.currency,
        mining_pool: app.normalizePool(curr.pool),
        avg_hashrate: curr.hashrate,
        accepted_shares: curr.accepted_shares,
        rejected_shares: curr.rejected_shares,
        gpu_hashrates: curr.gpu_hashrates
      }
    }),
    gpu_info: status.gpus.map(gpu => {
      return {
        ID: gpu.id,
        temp: gpu.temp,
        power: gpu.power,
        power_limit: gpu.power_limit,
        mem_clk: gpu.mem_clock,
        core_clk: gpu.gpu_clock,
        fan: gpu.fan
      }
    })
  }
  utils.file.write(path.join(app.dir.run, 'rig_state.json'), JSON.stringify(state, null, 2))
}

function drawStatus (status) {
  log.console = false
  clui.Clear()

  let buff = new clui.LineBuffer({x: 0, y: 0, width: 'console', height: 'console'})
  // Header
  let uptimeColor = status.uptime < 60 ? clc.yellow : clc.green
  new clui.Line(buff)
    .column(
      clc.bgGreen.black(` ${status.worker_name} `) + ' ' +
      `mining-mon ${clc.green('v' + app.version)}, ${status.miner_name} ${clc.green('v' + status.miner_version)}. ` +
      `${status.gpu_count} gpu${status.gpu_count > 1 ? 's' : ''}, NVIDIA driver ` + clc.green(`v${status.driver_version}`) + '. ' +
      'Uptime: ' + uptimeColor(`${utils.convert.toElapsed(status.uptime)}`) + '. '
    ).store()

  // GPUS
  // Header1
  let line = new clui.Line(buff)
    .column('', 66)
  status.mining.forEach(currency => {
    line.column(` ${currency.currency} `.padStart(12 + Math.ceil(currency.currency.length / 2)).padEnd(24), 24, [clc.bgCyan.black])
  })
  line.store()
  line = new clui.Line(buff)
    .column('', 66)
  status.mining.forEach(currency => {
    let pool = app.normalizePool(currency.pool)
    line.column(`${pool}`.padStart(12 + Math.ceil(pool.length / 2)).padEnd(24), 24, [clc.bgCyan.black])
  })
  line.store()
  // Header2
  line = new clui.Line(buff)
    .column('ID', 3, [clc.cyan])
    .column('Name', 13, [clc.cyan])
    .column('Fan', 6, [clc.cyan])
    .column('Temp', 6, [clc.cyan])
    .column('Power', 17, [clc.cyan])
    .column('Mem clock', 11, [clc.cyan])
    .column('GPU clock', 11, [clc.cyan])
  status.mining.forEach(() => {
    line.column('Hashrate', 10, [clc.cyan])
      .column('Shares', 14, [clc.cyan])
  })
  line.store()
  // Header 3
  line = new clui.Line(buff)
    .column('', 3, [clc.cyan])
    .column('', 13, [clc.cyan])
    .column('[%]', 6, [clc.cyan])
    .column('[C]', 6, [clc.cyan])
    .column('[W]', 17, [clc.cyan])
    .column('[MHz]', 11, [clc.cyan])
    .column('[MHz]', 11, [clc.cyan])
  status.mining.forEach(currency => {
    line.column(`[${app.hashrateUnit(currency.currency)}]`, 10, [clc.cyan])
      .column('acct/rej/inv', 14, [clc.cyan])
  })
  line.store()
  // GPU info
  status.gpus.forEach(gpu => {
    let ocPowerLimitColor = (val) => gpu.oc_power_limit ? clc.blueBright(val) : val
    line = new clui.Line(buff)
      .column('#' + gpu.id, 3, [clc.cyan])
      .column(gpu.product, 13)
      .column(' ' + gpu.fan + ' ', 6, stateColor(gpu.state_fan))
      .column(' ' + gpu.temp + ' ', 6, stateColor(gpu.state_temp))
      .column(ocPowerLimitColor(' ' + gpu.power.toFixed(2) + '/' + gpu.power_limit.toFixed(2) + ' '), 17, stateColor(gpu.state_power))
      .column(gpu.mem_clock + '/' + gpu.mem_clock_max, 11, gpu.oc_mem_clock ? [clc.blueBright] : [])
      .column(gpu.gpu_clock + '/' + gpu.gpu_clock_max, 11, gpu.oc_gpu_clock ? [clc.blueBright] : [])
    status.mining.forEach(currency => {
      let hashrate = app.normalizeHashrate(currency.currency, currency.gpu_hashrates[gpu.id])
      line.column(' ' + (hashrate ? hashrate.toFixed(2) : '-') + ' ', 10, stateColor(currency.gpu_hashrates_state[gpu.id]))
      line.column('' +
        currency.gpu_accepted_shares[gpu.id] + '/' +
        currency.gpu_rejected_shares[gpu.id] + '/' +
        currency.gpu_invalid_shares[gpu.id], 14)
    })
    line.store()
  })
  // Summary
  // Header1
  line = new clui.Line(buff)
    .column('', 3)
    .column('', 13)
    .column('', 6)
    .column('', 6)
    .column(' ' + status.gpus.reduce((prev, next) => prev + next.power, 0).toFixed(2), 17, [clc.cyan])
    .column('', 11)
    .column('', 11)
  status.mining.forEach(currency => {
    line.column(` ${app.normalizeHashrate(currency.currency, currency.hashrate).toFixed(2)} `, 10, [clc.cyan])
    line.column('' +
      currency.accepted_shares + '/' +
      currency.rejected_shares + '/' +
      currency.invalid_shares, 14, [clc.cyan])
  })
  line.store()
  new clui.Line(buff).store()

  // Draw watchdog status
  watchdog.drawStatus(buff)
  buff.output()
}

function start () {
  log.info(`Starting monitor in ${app.config.monitor_delay}s...`)
  setTimeout(() => {
    updateStatus()
  }, app.config.monitor_delay * 1000)
}

module.exports = {
  start
}
