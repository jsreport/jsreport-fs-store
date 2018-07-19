
module.exports = {
  'name': 'fs-store',
  'main': 'lib/main.js',
  'optionsSchema': {
    store: {
      type: 'object',
      properties: {
        provider: { type: 'string', enum: ['fs'] }
      }
    },
    extensions: {
      'fs-store': {
        type: 'object',
        properties: {
          syncModifications: { type: 'boolean' },
          dataDirectory: { type: 'string' },
          compactionInterval: { type: 'number' },
          corruptAlertThreshold: { type: 'number' },
          sync: {
            type: 'object',
            properties: {
              provider: { type: 'string' },
              usePolling: { type: 'boolean', default: true }
            }
          },
          persistence: {
            type: 'object',
            properties: {
              provider: { type: 'string' }
            }
          }
        }
      }
    }
  },
  'dependencies': [ 'templates' ]
}
