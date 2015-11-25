var IO = require('socket.io');

module.exports = function (reporter, definition) {
  if (reporter.options.connectionString.name.toLowerCase() === 'fs') {
    definition.enabled = true;
    reporter.documentStore.provider = new (require('./fsStore'))(reporter.documentStore.model, reporter.options);

    process.nextTick(function () {
      reporter.initializeListener.insert({after: 'express'}, 'fs-store', function () {
        if (!reporter.express.server) {
          throw new Error(
            'jsreport-fs-store needs a valid server instance.. ' +
            'if you are using jsreport in an existing express app pass a server instance to express.server option'
          );
        }

        var io = IO(reporter.express.server);

        reporter.documentStore.provider.on('external-modification', function () {
          io.emit('external-modification', {});
        });
      });
    });
  }
};