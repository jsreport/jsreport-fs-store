const chokidar = require('chokidar')
const Promise = require('bluebird')
const fs = require('fs')
Promise.promisifyAll(fs)

module.exports = ({ logger }) => ({ dataDirectory, fs, syncModifications, usePolling = true }) => ({
  init () {
    if (syncModifications === false) {
      return Promise.resolve()
    }

    this.tresholdForSkippingOwnProcessWrites = 800

    if (usePolling === true) {
      logger.debug(`fs store sync is configured to use polling for files watcher`)
    } else {
      logger.debug(`fs store sync is configured to use native os watching for files watcher`)
    }

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

  close () {
    if (this.watcher) {
      this.watcher.close()
    }
  }
})
