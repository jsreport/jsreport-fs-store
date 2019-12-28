const Persistence = require('./persistence')
const { uid, copy } = require('./customUtils')
const mingo = require('@jsreport/mingo')
const Promise = require('bluebird')
const documentModel = require('./documentModel')
const Queue = require('./queue')
const omit = require('lodash.omit')
const FileSystemPersistence = require('./fileSystem')
const FileSystemSync = require('./fileSystemSync')
const rimrafAsync = Promise.promisify(require('rimraf'))
const EventEmitter = require('events').EventEmitter
const extend = require('node.extend.without.arrays')

module.exports = ({
  dataDirectory,
  blobStorageDirectory,
  logger,
  sync = {},
  syncModifications,
  persistence = {},
  corruptAlertThreshold = 0.1,
  compactionEnabled = true,
  compactionInterval = 15000,
  persistenceQueueWaitingTimeout = 60000,
  createError
}) => {
  const pendingTransactions = new Map()
  const syncTransactions = new Map()

  function getTransactionQueue (tran) {
    const queue = {
      push: async (fn) => {
        const transactionActivation = pendingTransactions.get(tran.id)

        if (!transactionActivation) {
          throw new Error('Transaction does not exists to execute this operation')
        }

        await transactionActivation

        return fn()
      }
    }

    return queue
  }

  return {
    name: 'fs',
    queue: Queue(persistenceQueueWaitingTimeout),
    persistenceHandlers: {
      fs: FileSystemPersistence
    },
    syncHandlers: {
      fs: FileSystemSync({ logger })
    },
    fileExtensionResolvers: [],
    emitter: new EventEmitter(),
    createError,
    on (...args) {
      this.emitter.on(...args)
    },
    emit (...args) {
      this.emitter.emit(...args)
    },
    get dataDirectory () {
      return dataDirectory
    },
    async load (model) {
      this.documentsModel = documentModel(model)

      const PersistenceProvider = this.persistenceHandlers[persistence.provider]
      if (!PersistenceProvider) {
        throw new Error(`File system store persistence provider ${persistence.provider} was not registered`)
      }
      logger.info(`fs store is persisting using ${persistence.provider}`)
      this.fs = PersistenceProvider(Object.assign({ dataDirectory: dataDirectory }, persistence))

      if (syncModifications === false && sync.provider === 'fs') {
        this.sync = { subscribe: () => ({}), init: () => ({}), publish: () => ({}) }
        logger.info('fs store sync is disabled')
      } else {
        const Sync = this.syncHandlers[sync.provider]
        if (!Sync) {
          throw new Error(`fs store store synchronization with ${sync.provider} was not registered`)
        }

        logger.info(`fs store is synchronizing using ${sync.provider}`)

        this.sync = Sync(Object.assign({
          dataDirectory,
          fs: this.fs,
          blobStorageDirectory,
          syncTransactions,
          queue: this.queue
        }, sync))

        this.sync.subscribe(this._handleSync.bind(this))
      }

      this.persistence = Persistence({
        documentsModel: this.documentsModel,
        fs: this.fs,
        corruptAlertThreshold,
        resolveFileExtension: this._resolveFileExtension.bind(this)
      })

      await this.fs.init()
      await this._load()
      await this.sync.init()
      if (compactionEnabled) {
        await this._startCompactionInterval()
      }
      this._startPersistenceQueueTimeoutInterval()
      logger.info('fs store is initialized successfully')
    },

    async _load (noQueue = false) {
      let queue

      logger.info('fs store is loading data')

      if (noQueue) {
        // fake queue
        queue = { push: async (fn) => fn() }
      } else {
        queue = this.queue
      }

      return queue.push(async () => {
        const _documents = await this.persistence.load()
        this.documents = {}
        Object.keys(this.documentsModel.entitySets).forEach(e => (this.documents[e] = []))
        _documents.forEach(d => this.documents[d.$entitySet].push(d))
      })
    },

    beginTransaction () {
      // eslint-disable-next-line promise/param-names
      return new Promise((startResolve, startReject) => {
        let transactionActivation
        let transactionEnd

        const transactionActivationPromise = new Promise((resolve) => {
          transactionActivation = resolve
        })

        const transactionEndPromise = new Promise((resolve) => {
          transactionEnd = resolve
        })

        // eslint-disable-next-line promise/param-names
        const transactionExecutePromise = new Promise((execResolve) => {
          const transactionExecute = {
            resolve: execResolve
          }

          const transactionId = uid(16)

          pendingTransactions.set(transactionId, transactionActivationPromise)

          this.sync.publish({
            action: 'transaction-begin',
            transactionId
          }).then(() => {
            startResolve({
              id: transactionId,
              async commit () {
                transactionExecute.resolve()
                await transactionEndPromise
                pendingTransactions.delete(transactionId)
              },
              async rollback () {
                transactionExecute.resolve()
                await transactionEndPromise
                pendingTransactions.delete(transactionId)
              }
            })
          }).catch((syncErr) => {
            startReject(syncErr)
          })
        })

        this.queue.push(async () => {
          transactionActivation()
          await transactionExecutePromise
        }).then(() => {
          transactionEnd()
        }).catch(() => {
          transactionEnd()
        })
      })
    },

    async commitTransaction (tran) {
      try {
        await copy(this.fs, this.persistence.transactionDirectory, '', true)
      } catch (e) {
        let canContinue = false

        if (e.code === 'ENOENT' && e.path) {
          canContinue = this.fs.path.basename(e.path) === this.persistence.transactionDirectory
        }

        if (!canContinue) {
          throw e
        }
      }

      await this.fs.remove(this.persistence.transactionDirectory)

      for (const documents of Object.values(this.documents)) {
        documents.forEach((d, index) => {
          if (!d.$transaction) {
            return
          }

          const $currentTranState = d.$transaction

          if ($currentTranState.state === 'remove') {
            documents.splice(index, 1)
          } else if ($currentTranState.state === 'update') {
            documents[index] = {
              ...$currentTranState.updatedDoc
            }

            d = documents[index]
          }

          delete d.$transaction
        })
      }

      await tran.commit()

      await this.sync.publish({
        action: 'transaction-finish',
        transactionId: tran.id
      })
    },

    async rollbackTransaction (tran) {
      await this.fs.remove(this.persistence.transactionDirectory)

      for (const documents of Object.values(this.documents)) {
        documents.forEach((d, index) => {
          if (!d.$transaction) {
            return
          }

          const $currentTranState = d.$transaction

          if (
            $currentTranState.state === 'insert' ||
            ($currentTranState.state === 'update' && $currentTranState.created)
          ) {
            documents.splice(index, 1)
          }

          delete d.$transaction
        })
      }

      await tran.rollback()

      await this.sync.publish({
        action: 'transaction-finish',
        transactionId: tran.id
      })
    },

    find (entitySet, query, fields, opts = {}) {
      const documents = getDocuments(this.documents[entitySet], opts).map((d) => {
        // we return a copy of object to avoid getting mutations from other parts
        if (
          opts.transaction &&
          d.$transaction &&
          d.$transaction.id === opts.transaction.id && d.$transaction.updatedDoc
        ) {
          return extend(true, {}, d.$transaction.updatedDoc)
        }

        return extend(true, {}, d)
      })

      const cursor = mingo.find(documents, query, fields)

      // the queue is not used here because reads are supposed to not block
      cursor.toArray = () => cursor.all().map((v) => extend(true, {}, omit(v, '$$etag', '$entitySet', '$transaction')))

      return cursor
    },

    insert (entitySet, doc, opts = {}) {
      let queue

      if (opts.transaction) {
        queue = getTransactionQueue(opts.transaction)
      } else {
        queue = this.queue
      }

      return queue.push(async () => {
        doc._id = doc._id || uid(16)
        doc.$entitySet = entitySet

        const allDocuments = Object.keys(this.documents).reduce((acu, setName) => {
          acu[setName] = getDocuments(this.documents[setName], opts)
          return acu
        }, {})

        await this.persistence.insert(doc, allDocuments, opts.transaction)

        const clone = extend(true, {}, doc)

        clone.$$etag = Date.now()

        if (opts.transaction) {
          clone.$transaction = {
            id: opts.transaction.id,
            created: true,
            state: 'insert'
          }
        }

        this.documents[entitySet].push(clone)

        if (opts.transaction) {
          return doc
        }

        // big messages are sent as refresh, the others include the data right in the message
        if (JSON.stringify(clone).length < (this.sync.messageSizeLimit || 60 * 1024)) {
          await this.sync.publish({
            action: 'insert',
            doc: clone
          })
        } else {
          const entityType = this.documentsModel.entitySets[doc.$entitySet].entityType
          const eventDoc = {
            _id: clone._id,
            $entitySet: clone.$entitySet,
            $$etag: clone.$$etag,
            [entityType.publicKey]: clone[entityType.publicKey]
          }
          if (clone.folder) {
            eventDoc.folder = clone.folder
          }

          await this.sync.publish({
            action: 'refresh',
            doc: eventDoc
          })
        }

        return doc
      })
    },

    async update (entitySet, q, u, opts = {}) {
      let count
      let queue

      if (opts.transaction) {
        queue = getTransactionQueue(opts.transaction)
      } else {
        queue = this.queue
      }

      const res = await queue.push(async () => {
        const documents = getDocuments(this.documents[entitySet], opts)

        const allDocuments = Object.keys(this.documents).reduce((acu, setName) => {
          acu[setName] = getDocuments(this.documents[setName], opts)
          return acu
        }, {})

        const toUpdate = mingo.find(documents, q).all()

        count = toUpdate.length

        // need to get of queue first before calling insert, otherwise we get a deathlock
        if (toUpdate.length === 0 && opts.upsert) {
          return 'insert'
        }

        for (const doc of toUpdate) {
          await this.persistence.update(extend(true, {}, omit(doc, '$$etag', '$transaction'), u.$set || {}), doc, allDocuments, opts.transaction)

          if (opts.transaction) {
            doc.$transaction = doc.$transaction || { id: opts.transaction.id }
            doc.$transaction.updatedDoc = omit(extend(true, {}, doc, u.$set), '$transaction')
            doc.$transaction.state = 'update'
          } else {
            Object.assign(doc, u.$set || {})
          }

          doc.$$etag = Date.now()

          if (opts.transaction) {
            return
          }

          // big messages are sent as refresh, the others include the data right in the message
          if (JSON.stringify(doc).length < (this.sync.messageSizeLimit || 60 * 1024)) {
            await this.sync.publish({
              action: 'update',
              doc
            })
          } else {
            const entityType = this.documentsModel.entitySets[doc.$entitySet].entityType
            const eventDoc = {
              _id: doc._id,
              $entitySet: doc.$entitySet,
              $$etag: doc.$$etag,
              [entityType.publicKey]: doc[entityType.publicKey]
            }
            if (doc.folder) {
              eventDoc.folder = doc.folder
            }

            await this.sync.publish({
              action: 'refresh',
              doc: eventDoc
            })
          }
        }
      })

      if (res === 'insert') {
        await this.insert(entitySet, u.$set)
        return 1
      }

      return count
    },

    async remove (entitySet, q, opts = {}) {
      let queue

      if (opts.transaction) {
        queue = getTransactionQueue(opts.transaction)
      } else {
        queue = this.queue
      }

      return queue.push(async () => {
        const documents = getDocuments(this.documents[entitySet], opts)

        const allDocuments = Object.keys(this.documents).reduce((acu, setName) => {
          acu[setName] = getDocuments(this.documents[setName], opts)
          return acu
        }, {})

        const toRemove = mingo.find(documents, q).all()

        for (const doc of toRemove) {
          await this.persistence.remove(doc, allDocuments, opts.transaction)
        }

        if (opts.transaction) {
          toRemove.forEach((d) => {
            d.$transaction = d.$transaction || { id: opts.transaction.id }
            d.$transaction.state = 'remove'
          })
        } else {
          this.documents[entitySet] = this.documents[entitySet].filter(d => !toRemove.includes(d))
        }

        if (opts.transaction) {
          return
        }

        for (const doc of toRemove) {
          await this.sync.publish({
            action: 'remove',
            doc: {
              $entitySet: doc.$entitySet,
              _id: doc._id
            }
          })
        }
      })
    },

    addFileExtensionResolver (fn) {
      this.fileExtensionResolvers.push(fn)
    },

    registerSync (name, sync) {
      this.syncHandlers[name] = sync
    },

    registerPersistence (name, persistence) {
      this.persistenceHandlers[name] = persistence
    },

    _resolveFileExtension (doc, entitySetName, entityType, propType) {
      for (const resolver of this.fileExtensionResolvers) {
        const extension = resolver(doc, entitySetName, entityType, propType)
        if (extension) {
          return extension
        }
      }

      return propType.document.extension
    },

    _handleSync (e) {
      function process () {
        if (e.action === 'refresh') {
          return this.queue.push(async () => {
            const reloadedDoc = await this.persistence.reload(e.doc, this.documents)

            if (!reloadedDoc) {
              // deleted in the meantime
              return
            }

            const existingDoc = this.documents[e.doc.$entitySet].find((d) => d._id === e.doc._id)

            if (!existingDoc) {
              return this.documents[e.doc.$entitySet].push(reloadedDoc)
            }

            if (existingDoc.$$etag > e.doc.$$etag) {
              return
            }

            Object.assign(existingDoc, reloadedDoc)
          })
        }

        if (e.action === 'transaction-begin') {
          const transactionId = e.transactionId

          const pendingSyncTransactionPromise = new Promise((resolve) => {
            syncTransactions.set(transactionId, {
              finish: async () => {
                syncTransactions.delete(transactionId)
                resolve()
              }
            })
          })

          return this.queue.push(async () => {
            await pendingSyncTransactionPromise
          })
        }

        if (e.action === 'transaction-finish') {
          logger.debug('fs store sync is triggering reload, because transaction was finished')
          return this._load(true).then(() => {
            const tran = syncTransactions.get(e.transactionId)
            return tran.finish()
          })
        }

        if (e.action === 'reload') {
          return this.queue.push(() => {
            // we pass true here to don't use the queue and prevent a death lock queue
            return this._load(true)
          })
        }

        if (e.action === 'insert') {
          return this.queue.push(() => {
            this.documents[e.doc.$entitySet].push(e.doc)
          })
        }

        if (e.action === 'update') {
          return this.queue.push(() => {
            const originalDoc = this.documents[e.doc.$entitySet].find((d) => d._id === e.doc._id)

            if (!originalDoc) {
              return this.documents[e.doc.$entitySet].push(e.doc)
            }

            if (originalDoc.$$etag > e.doc.$$etag) {
              return
            }

            Object.assign(originalDoc, e.doc)
          })
        }

        if (e.action === 'remove') {
          return this.queue.push(() => {
            this.documents[e.doc.$entitySet] = this.documents[e.doc.$entitySet].filter((d) => d._id !== e.doc._id)
          })
        }
      }

      return Promise.resolve(process.apply(this))
        .then(() => this.emit('external-modification', e))
        .catch((e) => logger.error('Error when performing remote sync', e))
    },

    async close () {
      pendingTransactions.clear()
      syncTransactions.clear()

      if (this.sync.close) {
        await this.sync.close()
      }

      if (this.autoCompactionInterval) {
        clearInterval(this.autoCompactionInterval)
      }

      if (this.persistenceQueueTimeoutInterval) {
        clearInterval(this.persistenceQueueTimeoutInterval)
      }
    },

    drop () {
      this.close()
      return rimrafAsync(dataDirectory)
    },

    async _startCompactionInterval () {
      let compactIsQueued = false
      const compact = () => {
        if (compactIsQueued) {
          return
        }
        compactIsQueued = true
        return this.queue.push(() => Promise.resolve(this.persistence.compact(this.documents))).finally(() => (compactIsQueued = false))
      }
      this.autoCompactionInterval = setInterval(compact, compactionInterval).unref()
      // make sure we cleanup also when process just renders and exit
      // like when using jsreport.exe render
      await compact()
    },

    _startPersistenceQueueTimeoutInterval () {
      this.persistenceQueueTimeoutInterval = setInterval(() => this.queue.rejectItemsWithTimeout(), 2000).unref()
    }
  }
}

function getDocuments (documents, opts) {
  return documents.filter((d) => {
    if (d.$transaction == null) {
      return true
    }

    if (
      opts.transaction &&
      d.$transaction.id === opts.transaction.id
    ) {
      return d.$transaction.state !== 'remove'
    } else {
      return d.$transaction.created !== true
    }
  })
}
