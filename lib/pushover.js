const request = require('request')

const Priority = {
  lowest: -2,
  low: -1,
  normal: 0,
  high: 1
}

function notify (message, title, priority = Priority.normal) {
  if (notify.app && !notify.app.config.app_debug && notify.app.config.pushover_user && notify.app.config.pushover_token) {
    request
      .post('https://api.pushover.net/1/messages.json')
      .form({
        token: notify.app.config.pushover_token,
        user: notify.app.config.pushover_user,
        title: title || `${notify.app.config.worker_name} - mining-mon v${notify.app.version}`,
        message: message,
        priority: priority
      })
  }
}

notify.config = undefined

module.exports = {
  Priority, notify
}
