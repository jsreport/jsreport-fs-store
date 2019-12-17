
module.exports = {
  name: 'fs-store',
  main: 'lib/main.js',
  optionsSchema: {
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
          syncModifications: {
            type: ['boolean', 'object'],
            properties: {
              updateStudio: { type: 'boolean', default: false }
            }
          },
          dataDirectory: { type: 'string' },
          compactionEnabled: { type: 'boolean', default: true },
          compactionInterval: { type: 'number' },
          corruptAlertThreshold: { type: 'number' },
          persistenceQueueWaitingTimeout: { type: 'number' },
          sync: {
            type: 'object',
            default: {},
            properties: {
              provider: { type: 'string', enum: ['fs'], default: 'fs' },
              usePolling: { type: 'boolean', default: true },
              reloadDebounce: { type: 'number', default: 800 }
            }
          },
          persistence: {
            type: 'object',
            default: {},
            properties: {
              provider: { type: 'string', enum: ['fs'], default: 'fs' },
              lock: {
                type: 'object',
                properties: {
                  stale: { type: 'number', default: 5000 },
                  retries: { type: 'number', default: 100 },
                  retryWait: { type: 'number', default: 100 }
                }
              }
            }
          }
        }
      }
    }
  },
  dependencies: ['templates']
}
