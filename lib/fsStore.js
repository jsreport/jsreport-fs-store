/*!
 * Copyright(c) 2015 Jan Blaha
 *
 * DocumentStore data layer provider using neDb.
 */

var Promise = require('bluebird')
var Datastore = require('nedb')
var path = require('path')
var ListenerCollection = require('listener-collection')
var Persistence = require('./persistence.js')
var fs = require('fs-extra')
var events = require('events')
var util = require('util')
require('./deepCopy')

function EmbeddedCollection (name, model, options) {
  this.name = name
  this._options = options
  this.model = model
  this.entitySet = model.entitySets[name]
  this.entityType = model.entityTypes[this.entitySet.entityType.replace('jsreport.', '')]
  this.beforeFindListeners = new ListenerCollection()
  this.beforeUpdateListeners = new ListenerCollection()
  this.beforeInsertListeners = new ListenerCollection()
  this.beforeRemoveListeners = new ListenerCollection()
}

util.inherits(EmbeddedCollection, events.EventEmitter)

var EmbeddedProvider = module.exports = function (model, options) {
  this._model = model
  this._options = options
  this.collections = {}
  this.fileExtensionResolvers = []
  this._options.resolveFileExtension = this._resolveFileExtension.bind(this)
  this._options.syncModifications = this._options.syncModifications == null ? true : this._options.syncModifications
}

util.inherits(EmbeddedProvider, events.EventEmitter)

EmbeddedProvider.prototype.init = function () {
  var self = this

  this._options.logger.info('Initializing fs storage at ' + this._options.dataDirectory)

  var promises = Object.keys(this._model.entitySets).map(function (key) {
    var col = new EmbeddedCollection(key, self._model, self._options)

    if (self._options.syncModifications) {
      col.on('external-modification', function () {
        self.emit('external-modification')
      })
    }

    self.collections[key] = col
    return col.load()
  })

  return Promise.all(promises)
}

EmbeddedProvider.prototype.addFileExtensionResolver = function (fn) {
  this.fileExtensionResolvers.push(fn)
}

EmbeddedProvider.prototype._resolveFileExtension = function (doc, entitySetName, entityType, propType) {
  for (var i = 0; i < this.fileExtensionResolvers.length; i++) {
    var extension = this.fileExtensionResolvers[i](doc, entitySetName, entityType, propType)
    if (extension) {
      return extension
    }
  }

  return propType.document.extension
}

EmbeddedProvider.prototype.drop = function () {
  fs.removeSync(this._options.dataDirectory)
  fs.mkdirsSync(this._options.dataDirectory)
  return Promise.resolve()
}

EmbeddedProvider.prototype.collection = function (name) {
  return this.collections[name]
}

EmbeddedProvider.prototype.adaptOData = function (odataServer) {
  var self = this
  odataServer.model(this._model)
    .onNeDB(function (col, cb) {
      cb(null, self.collections[col]._db)
    }).beforeQuery(function (col, query, req, cb) {
      self.collections[col].beforeQuery(query, req).asCallback(cb)
    }).beforeUpdate(function (col, query, update, req, cb) {
      self.collections[col].beforeUpdate(query, update, req).asCallback(cb)
    }).beforeRemove(function (col, query, req, cb) {
      self.collections[col].beforeRemove(query, req).asCallback(cb)
    }).beforeInsert(function (col, doc, req, cb) {
      self.collections[col].beforeInsert(doc, req).asCallback(cb)
    })
}

EmbeddedCollection.prototype._convertBinaryToBuffer = function (res) {
  var self = this
  for (var i in res) {
    for (var prop in res[i]) {
      if (!prop) {
        continue
      }

      var propDef = self.entityType[prop]

      if (!propDef) {
        continue
      }

      if (propDef.type === 'Edm.Binary') {
        // nedb returns object instead of buffer on node 4
        if (!Buffer.isBuffer(res[i][prop]) && !res[i][prop].length) {
          var obj = res[i][prop]
          obj = obj.data || obj
          res[i][prop] = Object.keys(obj).map(function (key) {
            return obj[key]
          })
        }

        res[i][prop] = new Buffer(res[i][prop])
      }
    }
  }
}

EmbeddedCollection.prototype.load = function () {
  var self = this
  this._db = new Datastore({
    filename: path.join(this._options.dataDirectory, this.name),
    autoload: false,
    inMemoryOnly: this._options.connectionString.inMemory === true
  })

  Promise.promisifyAll(this._db)

  if (this.entitySet.splitIntoDirectories) {
    this._db.persistence = new Persistence({
      db: this._db,
      model: self.model,
      entitySetName: self.name,
      entityType: self.entityType,
      resolveFileExtension: this._options.resolveFileExtension,
      syncModifications: this._options.syncModifications
    })

    if (this._options.syncModifications) {
      this._db.persistence.on('external-modification', function () {
        self.emit('external-modification')
      })
    }
  }

  return this._db.loadDatabaseAsync().then(function () {
    if (typeof self._db.persistence.setAutocompactionInterval === 'function') {
      // allowing autocompaction of nedb each 5s, see this for more info:
      // https://github.com/jsreport/jsreport-fs-store/issues/12
      self._db.persistence.setAutocompactionInterval(5000)

      // unref the timer to prevent the process to stay open
      // if it is the last thing in the event loop
      self._db.persistence.autocompactionIntervalId.unref()
    }
  }).catch(function (ex) {
    self._options.logger.error('Failed to load collection ' + self.name, ex)
    throw ex
  })
}

EmbeddedCollection.prototype.find = function (query, req) {
  var self = this
  return this.beforeFindListeners.fire(query, req).then(function () {
    return self._db.findAsync(query).then(function (res) {
      self._convertBinaryToBuffer(res)
      return res
    })
  })
}

EmbeddedCollection.prototype.count = function (query) {
  return this._db.countAsync(query)
}

EmbeddedCollection.prototype.insert = function (doc, req) {
  var self = this
  return this.beforeInsertListeners.fire(doc, req).then(function () {
    return self._db.insertAsync(doc)
  })
}

EmbeddedCollection.prototype.update = function (query, update, options, req) {
  if (options && options.httpVersion) {
    req = options
    options = {}
  }

  options = options || {}
  var self = this
  return this.beforeUpdateListeners.fire(query, update, req).then(function () {
    return self._db.updateAsync(query, update, options)
  })
}

EmbeddedCollection.prototype.remove = function (query, req) {
  var self = this
  return this.beforeRemoveListeners.fire(query, req).then(function () {
    return self._db.removeAsync(query)
  })
}

EmbeddedCollection.prototype.beforeQuery = function (query, req) {
  this._options.logger.debug('OData query on ' + this.name)
  return this.beforeFindListeners.fire(query.$filter, req)
}

EmbeddedCollection.prototype.beforeInsert = function (doc, req) {
  this._options.logger.debug('OData insert into ' + this.name)
  return this.beforeInsertListeners.fire(doc, req)
}

EmbeddedCollection.prototype.beforeUpdate = function (query, update, req) {
  this._options.logger.debug('OData update on ' + this.name)
  return this.beforeUpdateListeners.fire(query, update, req)
}

EmbeddedCollection.prototype.beforeRemove = function (query, req) {
  this._options.logger.debug('OData remove from ' + this.name + ' ' + JSON.stringify(query))
  return this.beforeRemoveListeners.fire(query, req)
}
