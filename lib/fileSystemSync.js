const chokidar = require('chokidar')
const Promise = require('bluebird')
const fs = require('fs')
Promise.promisifyAll(fs)

module.exports = ({ fs, logger }) => ({ dataDirectory }) => ({
  init () {
    this.tresholdForSkippingOwnProcessWrites = 800

    this.watcher = chokidar.watch(dataDirectory, {
      ignorePermissionErrors: true,
      ignoreInitial: true,
      // chokidar for some reason doesn't fire for me on windows without usePolling
      // it was happening in average every 5th change, the usePolling seems to fix that
      usePolling: true,
      ignored: ['**/fs.lock', '**/~*']
    })
    return new Promise((resolve) => {
      this.watcher.on('ready', function () {
        resolve()
      })

      this.watcher.on('all', async (eventName, filePath) => {
        if (Math.abs(Date.now() - fs.lastWriteTimeStamp) < this.tresholdForSkippingOwnProcessWrites) {
          return
        }

        logger.debug(`fs store sync is triggering reload, because ${filePath} was changed by other process`)

        this.subscription({
          action: 'reload'
        })

        // todo, this is unfinished, mainly missing how to deal if something is deleted
        // we get an event that dir is being unlink, but how to find from sync what this dir is about
        /* try {
          const parentFolder = path.dirname(filePath)
          const configContent = await fs.readFileAsync(path.join(parentFolder, 'config.json'))
          this.subscription({
            action: 'refresh',
            doc: JSON.parse(configContent)
          })
        } catch (e) {
          // it can happen that only part of the final entity is written at this moment, so we silently ignore failures
          // to wait until config is parsable
        } */
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

  stop () {
    this.watcher.close()
  }
})
