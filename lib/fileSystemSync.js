const chokidar = require('chokidar')
const Promise = require('bluebird')
const debounce = require('lodash.debounce')
const nfs = require('fs')
Promise.promisifyAll(nfs)

async function exists (p) {
  try {
    await nfs.statAsync(p)
    return true
  } catch (e) {
    return false
  }
}

module.exports = ({ logger }) => ({
  dataDirectory,
  fs,
  syncModifications,
  blobStorageDirectory,
  usePolling = true,
  reloadDebounce = 800,
  queue
}) => ({
  init () {
    if (syncModifications === false) {
      return Promise.resolve()
    }

    if (usePolling === true) {
      logger.debug(`fs store sync is configured to use polling for files watcher`)
    } else {
      logger.debug(`fs store sync is configured to use native os watching for files watcher`)
    }

    const reload = debounce(filePath => {
      logger.debug(`fs store sync is triggering reload, because ${filePath} was changed by other process`)
      this.subscription({
        action: 'reload',
        filePath
      })
    }, reloadDebounce)

    const ignored = ['**/fs.lock', '**/~*', '**/.git/**']
    if (blobStorageDirectory && blobStorageDirectory.startsWith(dataDirectory)) {
      ignored.push(blobStorageDirectory.replace(/\\/g, '/'))
    }
    this.watcher = chokidar.watch(dataDirectory, {
      ignorePermissionErrors: true,
      ignoreInitial: true,
      // chokidar for some reason doesn't fire for me on windows without usePolling
      // it was happening in average every 5th change, the usePolling seems to fix that
      usePolling,
      ignored
    })

    return new Promise(resolve => {
      this.watcher.on('ready', function () {
        resolve()
      })

      this.watcher.on('all', (eventName, filePath, stat) => {
        return queue.push(async () => {
          try {
            if (eventName === 'addDir') {
              if (fs.memoryState[filePath] && fs.memoryState[filePath].isDirectory) {
                return
              }

              return reload(filePath)
            }

            if (eventName === 'unlinkDir') {
              if (!fs.memoryState[filePath] || !fs.memoryState[filePath].isDirectory) {
                return
              }

              if (await exists(filePath)) {
                return
              }

              return reload(filePath)
            }

            if (eventName === 'unlink') {
              if (!fs.memoryState[filePath] || fs.memoryState[filePath].isDirectory) {
                return
              }

              if (await exists(filePath)) {
                return
              }

              return reload(filePath)
            }

            const content = (await nfs.readFileAsync(filePath)).toString()

            if (!fs.memoryState[filePath] || content !== fs.memoryState[filePath].content) {
              reload(filePath)
            }
          } catch (e) {
          }
        })
      })
    })
  },

  subscribe (subscription) {
    this.subscription = subscription
  },

  // it is too late here
  // the file system sync doesn't publish any changes, the changes are being monitored
  publish () {},

  close () {
    if (this.watcher) {
      this.watcher.close()
    }
  }
})
