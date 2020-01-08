const { copy, lock, cloneDocuments } = require('./customUtils')

const transactionInconsistentDirectory = '~~.tran'
const transactionConsistentDirectory = '~.tran'

module.exports = ({ queue, persistence, fs }) => {
  let commitedDocuments = {}

  const persistenceQueueTimeoutInterval = setInterval(() => {
    queue.rejectItemsWithTimeout()
  }, 2000).unref()

  return {
    getCurrentDocuments (opts = {}) {
      return opts.transaction == null ? commitedDocuments : opts.transaction.documents
    },

    async init () {
      return lock(fs, async () => {
        await fs.remove(transactionInconsistentDirectory)
        if (await fs.exists(transactionConsistentDirectory)) {
          await copy(fs, transactionConsistentDirectory, '', [transactionConsistentDirectory], true)
          await fs.remove(transactionConsistentDirectory)
        }
      })
    },

    begin () {
      return queue.push(() => lock(fs, async () => {
        return {
          documents: cloneDocuments(commitedDocuments),
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
        return queue.push(() => lock(fs, () => {
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

      return queue.push(() => lock(fs, () => fn(commitedDocuments, persistence)))
    },

    async commit (transaction) {
      return queue.push(() => lock(fs, async () => {
        try {
          await fs.remove(transactionConsistentDirectory)
          await fs.remove(transactionInconsistentDirectory)

          await copy(fs, '', transactionInconsistentDirectory)

          const documentsClone = cloneDocuments(commitedDocuments)
          for (const op of transaction.operations) {
            await op(documentsClone, persistence, transactionInconsistentDirectory)
          }

          for (const entitySet in documentsClone) {
            for (const transactionEntity of documentsClone[entitySet]) {
              const commitedEntity = commitedDocuments[entitySet].find(e => e._id)
              if (commitedEntity &&
                transactionEntity.$$etag !== commitedEntity.$$etag &&
                commitedEntity.$$etag > transaction.beginTime
              ) {
                throw new Error(`Entity ${transactionEntity.name} was modified by another transaction`)
              }
            }
          }

          await fs.rename(transactionInconsistentDirectory, transactionConsistentDirectory)

          await copy(fs, transactionConsistentDirectory, '', [transactionConsistentDirectory], true)

          commitedDocuments = documentsClone
        } finally {
          await fs.remove(transactionConsistentDirectory)
          await fs.remove(transactionInconsistentDirectory)
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
