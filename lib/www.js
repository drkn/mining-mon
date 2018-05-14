const express = require('express')
const serveIndex = require('serve-index')
const app = require('./app')
const utils = require('./utils')
const path = require('path')
const send = require('send')
const log = require('./log')

function start () {
  if (app.config.worker_www_port) {
    log(`Starting http server on port ${app.config.worker_www_port}`)

    const server = express()

    // Logs
    server.use('/log', express.static(app.dir.log), serveIndex(app.dir.log, {'icons': true, 'view': 'details'}))
    server.get('/log/run.log', (req, res) => {
      let stream = send(req, app.file.log)
      stream.pipe(res)
    })
    server.get('/log/miner.log', (req, res) => {
      let stream = send(req, app.file.minerlog)
      stream.pipe(res)
    });

    ['rig_state.json', 'status.json'].forEach(file => {
      server.get('/' + file, (req, res) => {
        let data = utils.file.read(path.join(app.dir.run, file))
        res.setHeader('Content-Type', 'application/json')
        res.send(data)
      })
    })

    server.listen(app.config.worker_www_port, () => log('Http server started'))
  }
}

module.exports = {
  start
}
