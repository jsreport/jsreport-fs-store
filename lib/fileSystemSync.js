const chokidar = require('chokidar')
const Promise = require('bluebird')
const debounce = require('lodash.debounce')
const nfs = require('fs')
const { transactionDirectory } = require('./customUtils')
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
  blobStorageDirectory,
  syncTransactions,
  usePolling = true,
  reloadDebounce = 800,
  queue
}) => ({
  init () {
    if (usePolling === true) {
      logger.debug('fs store sync is configured to use polling for files watcher')
    } else {
      logger.debug('fs store sync is configured to use native os watching for files watcher')
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

    const isTransactionFile = (filePath) => {
      return (
        fs.path.basename(filePath).startsWith('fs.') &&
        fs.path.basename(filePath).endsWith('.tran')
      )
    }

    const getTransactionId = (filePath) => {
      const filenameParts = fs.path.basename(filePath).split('.')
      let tranId

      if (filenameParts.length === 2) {
        tranId = 'GENERAL'
      } else if (filenameParts.length === 4 && filenameParts[1] !== process.pid.toString()) {
        tranId = filenameParts[2]
      }

      return tranId
    }

    return new Promise(resolve => {
      this.watcher.on('ready', function () {
        resolve()
      })

      this.watcher.on('all', (eventName, filePath, stat) => {
        const transactionDirFullPath = `${fs.path.join(dataDirectory, transactionDirectory)}${fs.path.sep}`

        if (filePath.includes(transactionDirFullPath)) {
          return
        }

        if (isTransactionFile(filePath)) {
          if (eventName === 'add') {
            const tranId = getTransactionId(filePath)

            if (!tranId) {
              return
            }

            if (syncTransactions.has(tranId)) {
              return
            }

            return this.subscription({
              action: 'transaction-begin',
              transactionId: tranId
            })
          }

          if (eventName === 'unlink') {
            const tranId = getTransactionId(filePath)

            if (!tranId) {
              return
            }

            if (!syncTransactions.has(tranId)) {
              return
            }

            return this.subscription({
              action: 'transaction-finish',
              transactionId: tranId
            })
          }
        }

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
  async publish (message) {
    if (message.action === 'transaction-begin') {
      await fs.writeFile(`fs.${process.pid}.${message.transactionId}.tran`)
    } else if (message.action === 'transaction-finish') {
      await fs.remove(`fs.${process.pid}.${message.transactionId}.tran`)
    }
  },

  async close () {
    if (this.watcher) {
      await this.watcher.close()

      // in some cases chokidar still tries to emmit an event, even after close,
      // so we add an error handler to prevent having an uncaught exception
      this.watcher.once('error', () => {})
    }
  }
})
