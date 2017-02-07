var IO = require('socket.io')
var extend = require('node.extend')

module.exports = function (reporter, definition) {
  if (reporter.options.connectionString && reporter.options.connectionString.name.toLowerCase() !== 'fs') {
    definition.options.enabled = false
    return
  }

  var options = reporter.options.connectionString

  if (Object.getOwnPropertyNames(definition.options).length) {
    options = definition.options
    reporter.options.connectionString = options
    reporter.options.dataDirectory = options.dataDirectory || reporter.options.dataDirectory
  } else {
    definition.options = options
  }

  if (options.syncModifications == null) {
    options.syncModifications = reporter.options.mode !== 'production'
  }

  reporter.documentStore.provider = new (require('./fsStore'))(reporter.documentStore.model, extend(
    {},
    reporter.options,
    { logger: reporter.logger },
    { syncModifications: options.syncModifications }
  ))

  if (!options.syncModifications) {
    reporter.logger.info('synchronization of changes in jsreport-fs-store are disabled')
  }

  var expressRegistered = reporter.extensionsManager.extensions.filter(function (e) {
    return e.name === 'express'
  }).length

  if (!expressRegistered) {
    return
  }

  process.nextTick(function () {
    reporter.initializeListeners.insert({ after: 'express' }, 'fs-store', function () {
      var io

      if (options.syncModifications && !reporter.express.server) {
        reporter.logger.warn(
          'jsreport-fs-store needs a valid server instance to initialize socket link with the studio ' +
          'if you are using jsreport in an existing express app pass a server instance to express.server option'
        )
        return
      }

      if (options.syncModifications) {
        io = IO(reporter.express.server, {path: (reporter.options.appPath || '/') + 'socket.io'})

        reporter.documentStore.provider.on('external-modification', function () {
          io.emit('external-modification', {})
        })
      }
    })
  })
}
