const app = require('./lib/app')
const www = require('./lib/www')
const miner = require('./lib/miner')
const monitor = require('./lib/monitor')
const watchdog = require('./lib/watchdog')
const updater = require('./lib/updater')

app.start()

miner.start(true)
monitor.start()
watchdog.start()
www.start()
updater.start()
