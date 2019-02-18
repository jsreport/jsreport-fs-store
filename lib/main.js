/*!
 * Copyright(c) 2018 Jan Blaha
 *
 * File system based templates store for jsreport
 */

const Provider = require('./provider')
const IO = require('socket.io')
const path = require('path')

module.exports = function (reporter, definition) {
  if (reporter.options.store.provider !== 'fs') {
    definition.options.enabled = false
    return
  }

  if (definition.options.dataDirectory && !path.isAbsolute(definition.options.dataDirectory)) {
    definition.options.dataDirectory = path.join(reporter.options.rootDirectory, definition.options.dataDirectory)
  }

  if (definition.options.dataDirectory == null) {
    definition.options.dataDirectory = path.join(reporter.options.rootDirectory, 'data')
  }

  if (definition.options.syncModifications == null) {
    definition.options.syncModifications = reporter.options.mode !== 'production'
  }

  const options = Object.assign({
    logger: reporter.logger,
    createError: reporter.createError.bind(reporter)
  }, definition.options)

  const provider = Provider(options)

  // exposing api for fs-store persistence/sync extensions
  reporter.fsStore = {
    registerSync: (...args) => provider.registerSync(...args),
    registerPersistence: (...args) => provider.registerPersistence(...args)
  }

  reporter.documentStore.registerProvider(provider)

  if (!options.syncModifications) {
    reporter.logger.info('fs store underlying changes synchronization with studio is disabled')
  }

  reporter.closeListeners.add('fs-store', () => provider.close())

  if (!reporter.extensionsManager.extensions.some((e) => e.name === 'express')) {
    return
  }

  reporter.initializeListeners.add(definition.name, () => {
    if (reporter.express) {
      reporter.express.exposeOptionsToApi(definition.name, {
        syncModifications: definition.options.syncModifications
      })
    }
  })

  process.nextTick(() => {
    reporter.initializeListeners.insert({ after: 'express' }, 'fs-store', () => {
      if (!options.syncModifications) {
        reporter.logger.debug('fs store sync modifications is disabled')
      }

      if (options.syncModifications && !reporter.express.server) {
        reporter.logger.warn(
          'jsreport-fs-store needs a valid server instance to initialize socket link with the studio ' +
          'if you are using jsreport in an existing express app pass a server instance to express.server option'
        )
        return
      }

      if (options.syncModifications) {
        if (options.sync && options.sync.provider !== 'fs') {
          definition.options.syncModifications = false
          reporter.logger.info('fs store underlying changes synchronization with studio is skipped')
          return
        }

        reporter.logger.info('fs store emits sockets to synchronize underlying changes with studio')
        const io = IO(reporter.express.server, { path: (reporter.options.appPath || '/') + 'socket.io' })

        provider.on('external-modification', () => {
          reporter.logger.debug('Sending external-modification socket to the studio')
          io.emit('external-modification', {})
        })
      }
    })
  })
}
