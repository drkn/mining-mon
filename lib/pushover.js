const request = require('request')

const Priority = {
  lowest: -2,
  low: -1,
  normal: 0,
  high: 1
}

function notify (message, title = `MiningWin ${app.config.worker_name}`, priority = Priority.normal) {
  if (notify.config && notify.config.pushover_user && notify.config.pushover_token) {
    request
      .post('https://api.pushover.net/1/messages.json')
      .form({
        token: notify.config.pushover_token,
        user: notify.config.pushover_user,
        title: title || `MiningWin ${notify.config.worker_name}`,
        message: message,
        priority: priority
      })
      .on('error', (err) => {
        // (do nothing)
      })
  }
}

notify.config = undefined

module.exports = {
  Priority, notify
}