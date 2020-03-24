const Transaction = require('./transaction')
const Persistence = require('./persistence')
const { uid } = require('./customUtils')
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
  return {
    name: 'fs',
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

      this.persistence = Persistence({
        documentsModel: this.documentsModel,
        fs: this.fs,
        corruptAlertThreshold,
        resolveFileExtension: this._resolveFileExtension.bind(this)
      })

      this.transaction = Transaction({ queue: Queue(persistenceQueueWaitingTimeout), persistence: this.persistence, fs: this.fs, logger })

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
          transaction: this.transaction
        }, sync))

        this.sync.subscribe(this._handleSync.bind(this))
      }

      await this.fs.init()

      await this.transaction.init()

      await this._load()
      await this.sync.init()

      if (compactionEnabled) {
        await this._startCompactionInterval()
      }

      logger.info('fs store is initialized successfully')
    },

    async _load () {
      logger.info('fs store is loading data')

      return this.transaction.operation(async (documents) => {
        const _documents = await this.persistence.load()
        Object.keys(documents).forEach(k => delete documents[k])
        Object.keys(this.documentsModel.entitySets).forEach(e => (documents[e] = []))
        _documents.forEach(d => documents[d.$entitySet].push(d))
      })
    },

    beginTransaction () {
      return this.transaction.begin()
    },

    async commitTransaction (tran) {
      await this.transaction.commit(tran)
      return this.sync.publish({
        action: 'reload'
      })
    },

    async rollbackTransaction (tran) {
      return this.transaction.rollback(tran)
    },

    find (entitySet, query, fields, opts = {}) {
      const documents = this.transaction.getCurrentDocuments(opts)
      const cursor = mingo.find(documents[entitySet], query, fields)
      // the queue is not used here because reads are supposed to not block
      cursor.toArray = () => cursor.all().map((v) => extend(true, {}, omit(v, '$$etag', '$entitySet')))
      return cursor
    },

    insert (entitySet, doc, opts = {}) {
      return this.transaction.operation(opts, async (documents, persistence, rootDirectoy) => {
        doc._id = doc._id || uid(16)
        doc.$entitySet = entitySet

        await persistence.insert(doc, documents, rootDirectoy)

        const clone = extend(true, {}, doc)
        clone.$$etag = Date.now()

        documents[entitySet].push(clone)

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

      const res = await this.transaction.operation(opts, async (documents, persistence, rootDirectoy) => {
        const toUpdate = mingo.find(documents[entitySet], q).all()

        count = toUpdate.length

        // need to get of queue first before calling insert, otherwise we get a deathlock
        if (toUpdate.length === 0 && opts.upsert) {
          return 'insert'
        }

        for (const doc of toUpdate) {
          await persistence.update(extend(true, {}, omit(doc, '$$etag'), u.$set || {}), doc, documents, rootDirectoy)

          Object.assign(doc, u.$set || {})

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
        await this.insert(entitySet, u.$set, opts)
        return 1
      }

      return count
    },

    async remove (entitySet, q, opts = {}) {
      return this.transaction.operation(opts, async (documents, persistence, rootDirectoy) => {
        const toRemove = mingo.find(documents[entitySet], q).all()

        for (const doc of toRemove) {
          await persistence.remove(doc, documents, rootDirectoy)
        }

        documents[entitySet] = documents[entitySet].filter(d => !toRemove.includes(d))

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
          return this.transaction.operation(async (documents) => {
            const reloadedDoc = await this.persistence.reload(e.doc, documents)

            if (!reloadedDoc) {
              // deleted in the meantime
              return
            }

            const existingDoc = documents[e.doc.$entitySet].find((d) => d._id === e.doc._id)

            if (!existingDoc) {
              return documents[e.doc.$entitySet].push(reloadedDoc)
            }

            if (existingDoc.$$etag > e.doc.$$etag) {
              return
            }

            Object.assign(existingDoc, reloadedDoc)
          })
        }

        if (e.action === 'reload') {
          return this._load()
        }

        if (e.action === 'insert') {
          return this.transaction.operation((documents) => {
            documents[e.doc.$entitySet].push(e.doc)
          })
        }

        if (e.action === 'update') {
          return this.transaction.operation((documents) => {
            const originalDoc = documents[e.doc.$entitySet].find((d) => d._id === e.doc._id)

            if (!originalDoc) {
              return documents[e.doc.$entitySet].push(e.doc)
            }

            if (originalDoc.$$etag > e.doc.$$etag) {
              return
            }

            Object.assign(originalDoc, e.doc)
          })
        }

        if (e.action === 'remove') {
          return this.transaction.operation((documents) => {
            documents[e.doc.$entitySet] = documents[e.doc.$entitySet].filter((d) => d._id !== e.doc._id)
          })
        }
      }

      return Promise.resolve(process.apply(this))
        .then(() => this.emit('external-modification', e))
        .catch((e) => logger.error('Error when performing remote sync', e))
    },

    async close () {
      if (this.sync.close) {
        await this.sync.close()
      }

      if (this.autoCompactionInterval) {
        clearInterval(this.autoCompactionInterval)
      }

      this.transaction.close()
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
        return Promise.resolve(this.transaction.operation((documents) => this.persistence.compact(documents)))
          .catch((e) => logger.warn('fs store compaction failed, but no problem, it will retry the next time.' + e.message))
          .finally(() => (compactIsQueued = false))
      }
      this.autoCompactionInterval = setInterval(compact, compactionInterval).unref()
      // make sure we cleanup also when process just renders and exit
      // like when using jsreport.exe render
      await compact()
    }
  }
}
