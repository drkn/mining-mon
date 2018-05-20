const app = require('./app')
const log = require('./log')
const utils = require('./utils')
const path = require('path')

function start () {
  if (app.config.app_debug) {
    return log.info('Skipping autoupdate due to debug mode')
  }
  if (app.config.app_autoupdate === 0) {
    return log.info('Autoupdate disabled')
  }
  update()
}

function update () {
  log('Checking for updates')
  utils.process.spawn('update.bat', false, (code) => {
    let appVersion = JSON.parse(utils.file.read(path.join(app.dir.root, 'package.json'))).version
    if (appVersion !== app.version) {
      log.notice(`New app version found ${appVersion}. Restarting`)
      return utils.process.restart()
    }
    setTimeout(update, app.config.app_autoupdate * 60000)
  })
}

module.exports = {
  start
}
