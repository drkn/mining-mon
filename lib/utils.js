const childProcess = require('child_process')
const fs = require('fs')
const dns = require('dns')

function template (str, context, stack) {
  for (let key in context) {
    if (context.hasOwnProperty(key)) {
      if (typeof context[key] === 'object') {
        str = template(str, context[key], (stack ? stack + '.' : '') + key)
      } else {
        let find = '\\$\\{\\s*' + (stack ? stack + '.' : '') + key + '\\s*\\}'
        let re = new RegExp(find, 'g')
        str = str.replace(re, context[key])
      }
    }
  }
  return str
}

const process = {
  spawn: function (command, detached = true) {
    let cp = childProcess.spawn(command, {
      detached: detached,
      shell: true,
      stdio: 'ignore'
    })
    cp.unref()
    return cp.pid
  },
  exec: function (command) {
    return childProcess.execSync(command).toString('utf8').trim()
  },
  read: function (command) {
    return new Promise((resolve, reject) => {
      childProcess.exec(command, (error, stdout) => {
        if (error) {
          reject(error)
        } else {
          resolve(stdout)
        }
      })
    })
  }
}

const file = {
  write: function (file, contents) {
    fs.writeFile(file, contents, () => {})
  },
  read: function (file) {
    return fs.existsSync(file) ? fs.readFileSync(file) : ''
  }
}

const net = {
  online: function () {
    return new Promise(resolve => {
      dns.lookup('google.com', function (err) {
        resolve(err === null)
      })
    })
  }
}

const convert = {
  toFloat: function (value, digits = 2) {
    return parseFloat(parseFloat(value).toFixed(digits))
  },
  toElapsed: function (timeInSeconds) {
    let elapsed = {
      d: Math.floor(timeInSeconds / (60 * 60 * 24)),
      h: Math.floor(timeInSeconds / (60 * 60) % 24),
      m: Math.floor(timeInSeconds % (60 * 60) / 60),
      s: Math.floor(timeInSeconds % 60)
    }
    let result = '';
    ['d', 'h', 'm'].forEach(key => {
      if (elapsed[key]) {
        result += elapsed[key] + key
      }
    })
    return result + `${elapsed.s}s`
  }
}

module.exports = {
  template, process, file, net, convert
}
