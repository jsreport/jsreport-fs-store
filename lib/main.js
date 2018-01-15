/*!
 * Copyright(c) 2018 Jan Blaha
 *
 * File system based templates store for jsreport
 */

const Provider = require('./provider')
const IO = require('socket.io')

module.exports = function (reporter, definition) {
  if (!definition.options.forceProviderUsage && reporter.options.connectionString && reporter.options.connectionString.name.toLowerCase() !== 'fs') {
    return
  }

  const options = Object.assign({ dataDirectory: reporter.options.dataDirectory, logger: reporter.logger },
    definition.options, reporter.options.connectionString)
  const provider = Provider(options)

  // exposing api for fs-store persistence/sync extensions
  reporter.fsStore = {
    registerSync: (...args) => provider.registerSync(...args),
    registerPersistence: (...args) => provider.registerPersistence(...args)
  }
  reporter.documentStore.registerProvider(provider)

  if (options.syncModifications == null) {
    definition.options.syncModifications = options.syncModifications = reporter.options.mode !== 'production'
  }

  if (!options.syncModifications) {
    reporter.logger.info('fs store underlying changes synchronization with studio is disabled')
  }

  reporter.closeListeners.add('fs-store', () => provider.close())

  if (!reporter.extensionsManager.extensions.some((e) => e.name === 'express')) {
    return
  }

  process.nextTick(() => {
    reporter.initializeListeners.insert({ after: 'express' }, 'fs-store-2', () => {
      if (options.syncModifications && !reporter.express.server) {
        reporter.logger.warn(
          'jsreport-fs-store needs a valid server instance to initialize socket link with the studio ' +
          'if you are using jsreport in an existing express app pass a server instance to express.server option'
        )
        return
      }

      if (options.syncModifications) {
        if (options.sync && options.sync.name !== 'fs') {
          definition.options.syncModifications = false
          reporter.logger.info('fs store underlying changes synchronization with studio is skipped')
          return
        }

        reporter.logger.info('fs store emits sockets to synchronize underlying changes with studio')
        const io = IO(reporter.express.server, {path: (reporter.options.appPath || '/') + 'socket.io'})

        provider.on('external-modification', () => {
          reporter.logger.debug('Sending external-modification socket to the studio')
          io.emit('external-modification', {})
        })
      }
    })
  })
}
