const fs = require('fs')
const fx = require('mkdir-recursive')
const ini = require('ini')
const path = require('path')
const utils = require('./utils')
const dateFormat = require('dateformat')
const clc = require('cli-color')
const semver = require('semver')
const semverExtra = require('semver-extra')
const log = require('./log')
const notifyService = require('./pushover')
const packageJson = require('../package.json')

const now = Date.now()
const app = {
  name: process.mainModule.filename.split(path.sep).pop().split('.')[0],
  version: packageJson.version,
  startTs: now,
  startTime: dateFormat(now, 'yyyymmddHHMM'),
  dir: {
    root: path.join(__dirname, '..'),
    bin: 'bin',
    miners: 'miners',
    log: undefined,
    minerlog: undefined,
    run: 'run'
  },
  miners: {
    claymore: {
      args: '-logfile ${dir.log}/${startTime}-${config.miner_name}.log', // eslint-disable-line
      versions: []
    },
    ccminer: {
      args: '',
      versions: []
    }
  },
  configDebug: {},
  config: {
    worker_name: utils.process.exec('hostname'),
    worker_www_port: 8181,
    miner_name: undefined,
    miner_version: undefined,
    miner_binary: undefined,
    miner_dir: undefined,
    miner_args: undefined,
    miner_debug: 0, // Do not launch miner - just print debug stuff
    miner_delay: 15, // Delay in seconds after which miner binay will be started
    smi_path: path.join(__dirname, '..', 'bin', 'nvidia-smi.exe'),
    afterburner_path: 'C:\\Program Files (x86)\\MSI Afterburner\\MSIAfterburner.exe',
    afterburner_delay: 60, // Delay in seconds after which afterburner profile will be selected
    afterburner_profile: 0,
    monitor_delay: 15, // Delay in seconds after which monitor will be stared
    monitor_interval: 2, // Deleay in seconds between monitor stats refresh
    monitor_fan_max: undefined,
    monitor_fan_warn: undefined,
    monitor_temp_max: undefined,
    monitor_temp_warn: undefined,
    monitor_power_warn: undefined,
    monitor_power_max: undefined,
    monitor_hashrate_eth_min: undefined,
    monitor_hashrate_eth_warn: undefined,
    watchdog_tick: 2, // How often tick watchdog with new data set to ${monitor_interval} for the same time as monitor, 2 for two times less, 3 for three times less etc.
    watchdog_interval: 90, // How often watchdog will check for failures [s]
    watchdog_delay: 60, // How to watchdog will wait for startup and after resstart [s]
    watchdog_restart: true, // Should watchdog restart miner?
    pushover_token: undefined, // Pushover.net APP token
    pushover_user: undefined // Pushover.net User key
  },

  die (message) {
    log.error(message)
    process.exit(-1)
  },

  start (silent = false) {
    app.dir.run = path.join(app.dir.root, app.dir.run)
    app.dir.bin = path.join(app.dir.root, app.dir.bin)
    app.dir.miners = path.join(app.dir.bin, 'miners')
    app.dir.log = path.join(app.dir.run, 'log')

    app.file = {
      log: path.join(app.dir.log, `${app.startTime}-${app.name}.log`),
      minerlog: '',
      run: path.join(app.dir.run, `${app.name}.txt`)
    };

    [app.dir.run, app.dir.log].forEach(dir => {
      if (!fs.existsSync(dir)) {
        fx.mkdirSync(dir)
      }
    })

    log.fileName = app.file.log

    // Write process start time
    utils.file.write(app.file.run, app.startTime)

    // Configure
    app._readConfigFile('worker.conf')
    let runConf = app._readConfigFile('run.conf')
    let runConfWorker = app._readConfigFile(`run-${app.config.worker_name}.conf`)
    if (!runConf && !runConfWorker) {
      app.die(`Neither run.conf nor run-${app.config.worker_name} not found`)
    }
    app._templateConfig()
    app._loadMiners()
    app._checkConfig()
    notifyService.notify.app = app
    log.notice(`Starting mining-mon v${app.version}`)
    if (!silent) {
      app.printConfig()
    }
  },

  _templateConfig () {
    app.file.minerlog = `${app.dir.log}/${app.startTime}-${app.config.miner_name}.log`
    Object.keys(app.config).forEach(key => {
      if (typeof app.config[key] === 'string') {
        app.config[key] = utils.template(app.config[key], app.config)
      }
    })
    app.config.miner_args = utils.template(app.config.miner_args + ' ' + app.miners[app.config.miner_name].args, app)
  },

  _loadMiners () {
    // Load available miners
    fs.readdirSync(app.dir.miners).forEach(file => {
      const minerDir = path.join(app.dir.miners, file)
      const nameParts = file.split('_')
      if (nameParts.length === 2 &&
        app.miners[nameParts[0]] &&
        semver.valid(semver.coerce(nameParts[1])) &&
        fs.statSync(minerDir).isDirectory()) {
        // Find miner binary
        const binaryFiles = fs.readdirSync(minerDir).filter(
          minerFile => minerFile.indexOf('.exe') !== -1 &&
            minerFile.indexOf('.exe') === minerFile.length - 4 &&
            fs.statSync(path.join(minerDir, minerFile)).isFile())
        if (binaryFiles.length === 1) {
          app.miners[nameParts[0]].versions.push({
            miner_version: nameParts[1],
            miner_dir: minerDir,
            miner_binary: path.join(minerDir, binaryFiles[0])
          })
        }
      }
    })

    Object.keys(app.miners).forEach(miner => {
      const latestVersion = semverExtra.max(app.miners[miner].versions.map(version => semver.coerce(version.miner_version).raw))
      app.miners[miner].latest_version = app.miners[miner].versions.filter(version => semver.coerce(version.miner_version).raw === latestVersion)[0].miner_version
    })

    // Select miner from config
    if (!app.config.miner_binary) {
      let miner = app.miners[app.config.miner_name]
      if (!miner) {
        return
      }
      let minerVersion = app.config.miner_version || miner.miner_version
      let miners = miner.versions.filter(version => version.miner_version === minerVersion)
      if (miners.length === 0) {
        return
      }
      app.config = Object.assign(app.config, miners[0])
    }
  },

  _readConfigFile (name) {
    const filePath = path.join(app.dir.root, name)
    if (fs.existsSync(filePath)) {
      let readData = ini.parse(fs.readFileSync(filePath, 'utf8'))
      Object.keys(readData).forEach(key => { app.configDebug[key] = name })
      app.config = Object.assign(app.config, readData)
      return true
    } else {
      return false
    }
  },

  _checkConfig () {
    if (!fs.existsSync(app.config.smi_path)) {
      app.die('SMI not found: ', app.config.smi_path)
    }
    if (!fs.existsSync(app.config.afterburner_path)) {
      app.die('Afterburner not found:', app.config.afterburner_path)
    }
    if (!app.config.miner_binary) {
      app.die('Miner binary not found ...')
    }
  },

  printConfig () {
    log('Available miners:')
    Object.keys(app.miners).forEach(miner => {
      const minerConf = this.miners[miner]
      const minerVersions = minerConf.versions.map(conf => conf.miner_version)
      log(` - ${miner} - version(s): ${minerVersions.join(', ')}`)
    })
    log('App config:')
    Object.keys(app.config).forEach(key => {
      let message = ` - ${key} => ${clc.cyan(app.config[key])} ${clc.blackBright('(' + (app.configDebug[key] ? app.configDebug[key] : 'default') + ')')}`
      log(message)
    })
  },

  normalizeHashrate (currency, hashrate) {
    switch (currency) {
      default: // MHs
        return utils.convert.toFloat(hashrate / 1000000, 2)
    }
  },

  hashrateUnit (currency) {
    switch (currency) {
      default:
        return 'MHs'
    }
  },

  normalizePool (pool) {
    const pools = ['suprnova', 'ethermine', 'coinmine']
    for (let i = 0; i < pools.length; i++) {
      if (pool.indexOf(pools[i]) !== -1) {
        return pools[i].charAt(0).toUpperCase() + pools[i].slice(1)
      }
    }
    return pool
  }
}

module.exports = app
