const childProcess = require('child_process')
const fs = require('fs')
const path = require('path')
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

const proc = {
  spawn: function (command, detached = true, close) {
    let cp = childProcess.spawn(command, {
      cwd: path.join(__dirname, '..'),
      detached: detached,
      shell: true,
      stdio: 'ignore'
    })
    if (close) {
      cp.on('close', close)
    }
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
  },
  restart: function (timeout = 5000) {
    setTimeout(() => {
      proc.spawn('npm start')
      setTimeout(() => {
        process.exit()
      }, 0)
    }, timeout) // Safety timeout
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

const config = {
  isTrue (val) {
    return val === "1" || val === 1 || val === true || val === "true" || val === "yes"
  },
  isFalse (val) {
    return val === 0 || val === "0" || val === false || val === "false" || val === "no"
  }
}

module.exports = {
  template,
  process: proc,
  file,
  net,
  convert,
  config
}
