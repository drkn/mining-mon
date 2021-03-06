const app = require('./app')
const log = require('./log')
const utils = require('./utils')
const path = require('path')

function start () {
  if (utils.config.isTrue(app.config.app_debug)) {
    return log.info('Skipping autoupdate due to debug mode')
  }
  if (utils.config.isFalse(app.config.app_autoupdate)) {
    return log.info('Autoupdate disabled')
  }
  update()
}

function update () {
  log('Checking for updates')
  utils.process.spawn('update.bat', false, () => {
    let appVersion = JSON.parse(utils.file.read(path.join(app.dir.root, 'package.json'))).version
    if (appVersion !== app.version) {
      let restart = utils.config.isTrue(app.config.app_autoupdate_restart)
      log.notice(`New app version found ${appVersion}. ${restart ? 'Restarting' : 'Restart your worker'}`)
      if (restart) {
        return utils.process.restart()
      }
    }
    setTimeout(update, app.config.app_autoupdate * 60000)
  })
}

module.exports = {
  start
}
