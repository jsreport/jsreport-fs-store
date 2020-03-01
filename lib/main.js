/*!
 * Copyright(c) 2018 Jan Blaha
 *
 * File system based templates store for jsreport
 */

const Provider = require('./provider')
const IO = require('socket.io')
const path = require('path')
const { serialize, parse } = require('./customUtils')

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

  if (typeof definition.options.syncModifications !== 'object' && typeof definition.options.syncModifications !== 'boolean') {
    throw new Error('extensions.fs-store.syncModifications should be object or boolean')
  }

  let blobStorageDirectory = null
  if (reporter.options.blobStorage.provider === 'fs') {
    if (reporter.options.blobStorage.dataDirectory) {
      blobStorageDirectory = path.isAbsolute(reporter.options.blobStorage.dataDirectory)
        ? reporter.options.blobStorage.dataDirectory : path.join(reporter.options.rootDirectory, reporter.options.blobStorage.dataDirectory)
    } else {
      blobStorageDirectory = path.join(reporter.options.rootDirectory, 'data', 'storage')
    }
  }

  const options = Object.assign({
    logger: reporter.logger,
    createError: reporter.createError.bind(reporter),
    blobStorageDirectory
  }, definition.options)

  const provider = Provider(options)

  // exposing api for fs-store persistence/sync extensions
  reporter.fsStore = {
    registerSync: (...args) => provider.registerSync(...args),
    registerPersistence: (...args) => provider.registerPersistence(...args),
    serialize,
    parse
  }

  reporter.documentStore.registerProvider(provider)

  if (!reporter.extensionsManager.extensions.some((e) => e.name === 'express')) {
    return
  }

  let updateStudio = false
  reporter.initializeListeners.add(definition.name, () => {
    if (reporter.express) {
      reporter.express.exposeOptionsToApi(definition.name, {
        updateStudio
      })
    }
  })

  process.nextTick(() => {
    updateStudio = definition.options.syncModifications === true || definition.options.syncModifications.updateStudio === true

    if (!updateStudio) {
      reporter.logger.info('fs store underlying changes synchronization with studio is disabled')
      return
    }

    if (options.sync.provider !== 'fs') {
      updateStudio = false
      reporter.logger.info('fs store underlying changes synchronization with studio is skipped, it can run only with fs sync')
      return
    }

    reporter.initializeListeners.insert({ after: 'express' }, 'fs-store', () => {
      if (!reporter.express.server) {
        reporter.logger.warn(
          'jsreport-fs-store needs a valid server instance to initialize socket link with the studio ' +
          'if you are using jsreport in an existing express app pass a server instance to express.server option'
        )
        return
      }

      reporter.logger.info('fs store emits sockets to synchronize underlying changes with studio')
      const io = IO(reporter.express.server, { path: (reporter.options.appPath || '/') + 'socket.io' })

      provider.on('external-modification', (e) => {
        if (e.filePath && path.dirname(e.filePath) === definition.options.dataDirectory) {
          // skip for root files like reports, users, settings
          return
        }
        reporter.logger.debug('Sending external-modification socket to the studio')
        io.emit('external-modification', {})
      })
    })
  })
}
