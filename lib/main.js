var IO = require('socket.io');

module.exports = function (reporter, definition) {
  if (reporter.options.connectionString.name.toLowerCase() === 'fs') {
    reporter.documentStore.provider = new (require('./fsStore'))(reporter.documentStore.model, reporter.options);

    process.nextTick(function () {
      reporter.initializeListener.insert({after: 'express'}, 'fs-store', function () {
        var io = IO(reporter.express.server);

        reporter.documentStore.provider.on('external-modification', function () {
          io.emit('external-modification', {});
        });
      });
    });
  }
};