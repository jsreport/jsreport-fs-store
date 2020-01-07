const extend = require('node.extend.without.arrays')

function clone (obj) {
  return Object.keys(obj).reduce((acu, setName) => {
    acu[setName] = obj[setName].map((doc) => extend(true, {}, doc))
    return acu
  }, {})
}

module.exports = ({ queue, persistence }) => {
  let commitedDocuments = {}

  const persistenceQueueTimeoutInterval = setInterval(() => {
    queue.rejectItemsWithTimeout()
  }, 2000).unref()

  return {
    getCurrentDocuments (opts = {}) {
      return opts.transaction == null ? commitedDocuments : opts.transaction.documents
    },

    async init () {
      return persistence.lock(async () => {
        if (await persistence.exists(persistence.transactionConsistentDirectory)) {
          await persistence.copy(persistence.transactionConsistentDirectory, '', true)
          await persistence.removeDirectory(persistence.transactionConsistentDirectory)
        }
      })
    },

    begin () {
      return queue.push(() => persistence.lock(async () => {
        return {
          documents: clone(commitedDocuments),
          operations: [],
          beginTime: Date.now()
        }
      }))
    },

    async operation (opts, fn) {
      if (fn == null) {
        fn = opts
      }

      if (opts.transaction) {
        return queue.push(() => persistence.lock(() => {
          // the transaction operations shouldn't do real writes to the disk, just memory changes
          // we store the function call so we can replay it during commit to the disk
          const persistenceStub = {
            insert: () => {},
            update: () => {},
            remove: () => {}
          }

          opts.transaction.operations.push(fn)
          return fn(opts.transaction.documents, persistenceStub)
        }))
      }

      return queue.push(() => persistence.lock(() => fn(commitedDocuments, persistence)))
    },

    async commit (transaction) {
      return queue.push(() => persistence.lock(async () => {
        try {
          await persistence.copy('', persistence.transactionInconsistentDirectory)

          const documentsClone = clone(commitedDocuments)
          for (const op of transaction.operations) {
            await op(documentsClone, persistence)
          }

          for (const entitySet in documentsClone) {
            for (const transactionEntity of documentsClone[entitySet]) {
              const commitedEntity = commitedDocuments[entitySet].find(e => e._id)
              if (commitedEntity &&
                transactionEntity.$$etag !== commitedEntity.$$etag &&
                commitedEntity.$$etag > transaction.beginTime
              ) {
                await persistence.removeDirectory(persistence.transactionConsistentDirectory)
                throw new Error(`Entity ${transactionEntity.name} was modified by another transaction`)
              }
            }
          }

          await persistence.renameDirectory(persistence.transactionInconsistentDirectory, persistence.transactionConsistentDirectory)
          await persistence.copy(persistence.transactionConsistentDirectory, '', true)
          await persistence.removeDirectory(persistence.transactionConsistentDirectory)

          commitedDocuments = documentsClone
        } finally {
          await persistence.removeDirectory(persistence.transactionConsistentDirectory)
          await persistence.removeDirectory(persistence.transactionInconsistentDirectory)
        }
      }))
    },

    async rollback (transaction) {
    },

    close () {
      clearInterval(persistenceQueueTimeoutInterval)
    }
  }
}
