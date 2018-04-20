
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
          sync: {
            type: 'object',
            properties: {
              name: { type: 'string' }
            }
          },
          persistence: {
            type: 'object',
            properties: {
              name: { type: 'string' }
            }
          }
        }
      }
    }
  },
  'dependencies': [ 'templates' ]
}
