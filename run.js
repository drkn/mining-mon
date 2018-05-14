const app = require('./lib/app')
const www = require('./lib/www')
const miner = require('./lib/miner')
const monitor = require('./lib/monitor')
const watchdog = require('./lib/watchdog')

app.start()

miner.start()
monitor.start()
watchdog.start()
www.start()
