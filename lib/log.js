const notifyService = require('./pushover')
const fs = require('fs')
const clc = require('cli-color')
const ansiStrip = require('cli-color/strip')
const dateFormat = require('dateformat')

const log = function (level, ...args) {
  let ts = dateFormat(Date.now(), 'yyyy-mm-dd HH:MM:ss')
  let message = `${level.padStart(6)} ${(args || []).join(' ')}`
  let notifyPriority
  switch (level) {
    case 'ERROR':
      notifyPriority = notifyService.Priority.high
      message = clc.red(message)
      break
    case 'WARN':
      message = clc.yellow(message)
      break
    case 'NOTICE':
      notifyPriority = notifyService.Priority.normal
      message = clc.green(message)
      break
  }
  if (logger.console) {
    console.log(message)
  }
  let rawMessage = ansiStrip(`${ts} ${message}\n`)
  if (logger.fileName) {
    fs.appendFileSync(logger.fileName, rawMessage, 'utf8')
  }
  if (notifyService && notifyPriority !== undefined) {
    notifyService.notify(ansiStrip(message), null, notifyPriority)
  }
}

const logger = function () {
  log('INFO', Array.from(arguments))
}

logger.console = true
logger.fileName = undefined
logger.info = function () {
  log('INFO', Array.from(arguments))
}
logger.error = function () {
  log('ERROR', Array.from(arguments))
}
logger.warn = function () {
  log('WARN', Array.from(arguments))
}
logger.notice = function () {
  log('NOTICE', Array.from(arguments))
}

module.exports = logger
