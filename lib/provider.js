const Persistence = require('./persistence')
const { uid } = require('./customUtils')
const mingo = require('mingo')
const Promise = require('bluebird')
const documentModel = require('./documentModel')
const FileSystemPersistence = require('./fileSystem')
const FileSystemSync = require('./fileSystemSync')
const Queue = require('./queue')
const omit = require('lodash.omit')
const EventEmitter =
require('events').EventEmitter

module.exports = ({ dataDirectory, logger, sync = {}, persistence = {} }) => ({
  name: 'fs',
  queue: Queue(),
  persistenceHandlers: {},
  syncHandlers: {},
  fileExtensionResolvers: [],
  emitter: new EventEmitter(),
  on (...args) {
    this.emitter.on(...args)
  },
  emit (...args) {
    this.emitter.emit(...args)
  },
  async load (model) {
    this.documentsModel = documentModel(model)

    let PersistenceProvider
    if (!persistence.name || persistence.name === 'fs') {
      logger.info('fs store is persisting using default file system')
      PersistenceProvider = FileSystemPersistence
    } else {
      PersistenceProvider = this.persistenceHandlers[persistence.name]

      if (!PersistenceProvider) {
        throw new Error(`File system store persistence provider ${persistence.name} was not registered`)
      }

      logger.info(`fs store is persisting using ${persistence.name}`)
    }
    this.fs = PersistenceProvider(Object.assign({dataDirectory: dataDirectory}, persistence))

    let Sync
    if (!sync.name || sync.name === 'fs') {
      if (persistence.name && persistence.name !== 'fs') {
        throw new Error('File system store sync can run only if the persistence is set to fs')
      }
      logger.info('fs store is using default file system based synchronization')
      Sync = FileSystemSync({ fs: this.fs, logger: logger })
    } else {
      Sync = this.syncHandlers[sync.name]

      if (!Sync) {
        throw new Error(`File system store synchronization with ${sync.name} was not registered`)
      }

      logger.info(`fs store is using ${sync.name} synchronization`)
    }
    this.sync = Sync(Object.assign({dataDirectory: dataDirectory}, sync))
    this.sync.subscribe(this._handleSync.bind(this))

    this.persistence = Persistence({
      documentsModel: this.documentsModel,
      fs: this.fs,
      resolveFileExtension: this._resolveFileExtension.bind(this)
    })

    await this.fs.init()
    await this._load()
    await this.sync.init()
    logger.info(`fs store is initialized successfully`)
  },

  async _load () {
    logger.info(`fs store is loading data`)
    return this.queue(async () => {
      const _documents = await this.persistence.load()
      this.documents = {}
      Object.keys(this.documentsModel.entitySets).forEach(e => (this.documents[e] = []))
      _documents.forEach(d => this.documents[d.$entitySet].push(d))
    })
  },

  find (entitySet, query, fields, options) {
    const cursor = mingo.find(this.documents[entitySet], query, fields)
    cursor.toArray = () => this.queue(async () => Promise.resolve(cursor.all().map((v) => omit(v, '$$etag'))))
    return cursor
  },

  insert (entitySet, doc) {
    return this.queue(async () => {
      doc._id = uid(16)
      doc.$entitySet = entitySet
      await this.persistence.insert(doc)
      const clone = Object.assign({}, doc)
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
    const res = await this.queue(async () => {
      const toUpdate = mingo.find(this.documents[entitySet], q).all()

      // need to get of queue first before calling insert, otherwise we get a deathlock
      if (toUpdate.length === 0 && opts.upsert) {
        return 'insert'
      }

      for (const doc of toUpdate) {
        await this.persistence.update(Object.assign({}, omit(doc, '$$etag'), u.$set || {}), doc)
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
      return this.insert(entitySet, u.$set)
    }
  },

  async remove (entitySet, q) {
    return this.queue(async () => {
      const toRemove = mingo.find(this.documents[entitySet], q).all()

      for (const doc of toRemove) {
        await this.persistence.remove(doc)
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
    function process () {
      if (e.action === 'refresh') {
        return this.queue(async () => {
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
        return this.queue(() => {
          this._load()
        })
      }

      if (e.action === 'insert') {
        return this.queue(() => {
          this.documents[e.doc.$entitySet].push(e.doc)
        })
      }

      if (e.action === 'update') {
        return this.queue(() => {
          const originalDoc = this.documents[e.doc.$entitySet].find((d) => d._id === e.doc._id)

          if (originalDoc.$$etag > e.doc.$$etag) {
            return
          }

          Object.assign(originalDoc, e.doc)
        })
      }

      if (e.action === 'remove') {
        return this.queue(() => {
          this.documents[e.doc.$entitySet] = this.documents[e.doc.$entitySet].filter((d) => d._id !== e.doc._id)
        })
      }
    }

    return Promise.resolve(process.apply(this))
      .then(() => this.emit('external-modification'))
      .catch((e) => logger.error('Error when performing remote sync', e))
  }
})
