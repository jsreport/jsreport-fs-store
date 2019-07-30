const chokidar = require('chokidar')
const Promise = require('bluebird')
const debounce = require('lodash.debounce')
const fs = require('fs')
Promise.promisifyAll(fs)

module.exports = ({ logger }) => ({ dataDirectory, fs, syncModifications, usePolling = true, reloadDebounce = 800 }) => ({
  init () {
    if (syncModifications === false) {
      return Promise.resolve()
    }

    if (usePolling === true) {
      logger.debug(`fs store sync is configured to use polling for files watcher`)
    } else {
      logger.debug(`fs store sync is configured to use native os watching for files watcher`)
    }

    const reload = debounce((filePath) => {
      logger.debug(`fs store sync is triggering reload, because ${filePath} was changed by other process`)
      this.subscription({
        action: 'reload',
        filePath
      })
    }, reloadDebounce)

    this.watcher = chokidar.watch(dataDirectory, {
      ignorePermissionErrors: true,
      ignoreInitial: true,
      // chokidar for some reason doesn't fire for me on windows without usePolling
      // it was happening in average every 5th change, the usePolling seems to fix that
      usePolling,
      ignored: ['**/fs.lock', '**/~*', '**/.git/**']
    })

    return new Promise((resolve) => {
      this.watcher.on('ready', function () {
        resolve()
      })

      this.watcher.on('all', (eventName, filePath, stat) => {
        if (!stat) {
          return
        }

        if (fs.lockStart && (stat.mtime >= fs.lockStart && (fs.lockEnd == null || stat.mtime <= fs.lockEnd))) {
          return
        }

        reload(filePath)
      })
    })
  },

  subscribe (subscription) {
    this.subscription = subscription
  },

  // it is too late here
  // the file system sync doesn't publish any changes, the changes are being monitored
  publish () {
  },

  close () {
    if (this.watcher) {
      this.watcher.close()
    }
  }
})
