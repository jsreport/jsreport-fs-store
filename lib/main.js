var IO = require('socket.io')
var extend = require('node.extend')

module.exports = function (reporter, definition) {
  var options = {}
  var syncModifications = true

  definition.enabled = false

  if (reporter.options.connectionString && reporter.options.connectionString.name.toLowerCase() === 'fs') {
    options = reporter.options.connectionString
    definition.enabled = true
  }

  if (Object.getOwnPropertyNames(definition.options).length) {
    options = definition.options
    reporter.options.connectionString = options
    reporter.options.dataDirectory = options.dataDirectory || reporter.options.dataDirectory
    syncModifications = options.syncModifications !== false
    definition.enabled = true
  }

  if (!definition.enabled) {
    return
  }

  reporter.documentStore.provider = new (require('./fsStore'))(reporter.documentStore.model, extend(
    {},
    reporter.options,
    { syncModifications: syncModifications }
  ))

  if (!syncModifications) {
    reporter.logger.info('synchronization of changes in jsreport-fs-store are disabled')
  }

  var expressRegistered = reporter.extensionsManager.extensions.filter(function (e) {
    return e.name === 'express'
  }).length

  if (!expressRegistered) {
    return
  }

  process.nextTick(function () {
    reporter.initializeListener.insert({ after: 'express' }, 'fs-store', function () {
      var io

      if (syncModifications && !reporter.express.server) {
        reporter.logger.warn(
          'jsreport-fs-store needs a valid server instance to initialize socket link with the studio ' +
          'if you are using jsreport in an existing express app pass a server instance to express.server option'
        )
        return
      }

      if (syncModifications) {
        io = IO(reporter.express.server)

        reporter.documentStore.provider.on('external-modification', function () {
          io.emit('external-modification', {})
        })
      }
    })
  })
}
