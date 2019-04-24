const Persistence = require('./persistence')
const { uid } = require('./customUtils')
const mingo = require('mingo')
const Promise = require('bluebird')
const documentModel = require('./documentModel')
const Queue = require('./queue')
const omit = require('lodash.omit')
const FileSystemPersistence = require('./fileSystem')
const FileSystemSync = require('./fileSystemSync')
const rimrafAsync = Promise.promisify(require('rimraf'))
const EventEmitter = require('events').EventEmitter
const extend = require('node.extend.without.arrays')
const uniqBy = require('lodash.uniqby')

module.exports = ({
  dataDirectory,
  logger,
  sync = {},
  persistence = {},
  syncModifications,
  corruptAlertThreshold = 0.1,
  compactionInterval = 15000,
  persistenceQueueWaitingTimeout = 60000,
  createError
}) => ({
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

    const PersistenceProvider = this.persistenceHandlers[persistence.provider || 'fs']
    if (!PersistenceProvider) {
      throw new Error(`File system store persistence provider ${persistence.provider} was not registered`)
    }
    logger.info(`fs store is persisting using ${persistence.provider || 'fs'}`)
    this.fs = PersistenceProvider(Object.assign({ dataDirectory: dataDirectory }, persistence))

    if (!sync.provider && persistence.provider && persistence.provider !== 'fs') {
      // no syncing by default for non fs based persistence
      logger.info(`fs store is using no synchronization`)
      this.sync = { subscribe: () => ({}), init: () => ({}), publish: () => ({}) }
    } else {
      const Sync = this.syncHandlers[sync.provider || 'fs']
      if (!Sync) {
        throw new Error(`File system store synchronization with ${sync.provider} was not registered`)
      }

      logger.info(`fs store is synchronizing using ${sync.provider || 'fs'}`)

      this.sync = Sync(Object.assign({
        dataDirectory: dataDirectory,
        fs: this.fs,
        syncModifications
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
    await this._startCompactionInterval()
    this._startPersistenceQueueTimeoutInterval()
    logger.info(`fs store is initialized successfully`)
  },

  async _load () {
    logger.info(`fs store is loading data`)
    return this.queue.push(async () => {
      const _documents = await this.persistence.load()
      this.documents = {}
      Object.keys(this.documentsModel.entitySets).forEach(e => (this.documents[e] = []))
      _documents.forEach(d => this.documents[d.$entitySet].push(d))
    })
  },

  find (entitySet, query, fields, options) {
    const cursor = mingo.find(this.documents[entitySet], query, fields)
    cursor.toArray = () => this.queue.push(async () => Promise.resolve(
      uniqBy(cursor.all(), '_id').map((v) => extend(true, {}, omit(v, '$$etag', '$entitySet')))))
    return cursor
  },

  insert (entitySet, doc) {
    return this.queue.push(async () => {
      doc._id = doc._id || uid(16)
      doc.$entitySet = entitySet
      await this.persistence.insert(doc, this.documents)
      const clone = extend(true, {}, doc)
      clone.$$etag = Date.now()
      this.documents[entitySet].push(clone)

      // big messages are sent as refresh, the others include the data right in the message
      if (JSON.stringify(clone).length < (this.sync.messageSizeLimit || 60 * 1024)) {
        await this.sync.publish({
          action: 'insert',
          doc: clone
        })
      } else {
        const entityType = this.documentsModel.entitySets[doc.$entitySet].entityType
        const eventDoc = { _id: clone._id, $entitySet: clone.$entitySet }
        eventDoc[entityType.publicKey] = clone[entityType.publicKey]

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
    const res = await this.queue.push(async () => {
      const toUpdate = mingo.find(this.documents[entitySet], q).all()
      count = toUpdate.length

      // need to get of queue first before calling insert, otherwise we get a deathlock
      if (toUpdate.length === 0 && opts.upsert) {
        return 'insert'
      }

      for (const doc of toUpdate) {
        await this.persistence.update(extend(true, {}, omit(doc, '$$etag'), u.$set || {}), doc, this.documents)
        Object.assign(doc, u.$set || {})
        doc.$$etag = Date.now()

        // big messages are sent as refresh, the others include the data right in the message
        if (JSON.stringify(doc).length < (this.sync.messageSizeLimit || 60 * 1024)) {
          await this.sync.publish({
            action: 'update',
            doc
          })
        } else {
          const entityType = this.documentsModel.entitySets[doc.$entitySet].entityType
          const eventDoc = { _id: doc._id, $entitySet: doc.$entitySet }
          eventDoc[entityType.publicKey] = doc[entityType.publicKey]

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

  async remove (entitySet, q) {
    return this.queue.push(async () => {
      const toRemove = mingo.find(this.documents[entitySet], q).all()

      for (const doc of toRemove) {
        await this.persistence.remove(doc, this.documents)
      }
      this.documents[entitySet] = this.documents[entitySet].filter(d => !toRemove.includes(d))

      for (const doc of toRemove) {
        await this.sync.publish({
          action: 'remove',
          doc
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
    let reloadPromise
    function process () {
      if (e.action === 'refresh') {
        return this.queue.push(async () => {
          const doc = this.documents[e.doc.$entitySet].find((d) => d._id === e.doc._id)
          const reloadedDoc = await this.persistence.reload(e.doc)

          if (!reloadedDoc) {
            // deleted in the meantime
            this.documents[e.doc.$entitySet] = this.documents[e.doc.$entitySet].filter(d => d._id !== e.doc._id)
            return
          }

          reloadedDoc.$$etag = Date.now()

          if (!doc) {
            // inserting new
            return this.documents[e.doc.$entitySet].push(reloadedDoc)
          }

          Object.assign(doc, reloadedDoc)
        })
      }

      if (e.action === 'reload') {
        return this.queue.push(() => {
          // returning here would death lock queue
          reloadPromise = this._load()
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
      .then(() => Promise.resolve(reloadPromise))
      .then(() => this.emit('external-modification'))
      .catch((e) => logger.error('Error when performing remote sync', e))
  },

  async close () {
    if (this.sync.close) {
      this.sync.close()
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
})
