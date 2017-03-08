/*eslint no-extend-native: 0*/

/**
 * Fork of nedb persistence
 * Enables storing data in multile files
 */

/**
 * Handle every persistence-related task
 * The interface Datastore expects to be implemented is
 * * Persistence.loadDatabase(callback) and callback has signature err
 * * Persistence.persistNewState(newDocs, callback) where newDocs is an array of documents and callback has signature err
 */

var fs = require('fs-extra');
var path = require('path');
var async = require('async');
var mkdirp = require('mkdirp');
var extend = require('node.extend');
var glob = require('glob');
var chokidar = require('chokidar');
var _ = require('underscore');
var events = require('events');
var util = require('util');

/**
 * Create a new Persistence object for database options.db
 * @param {Datastore} options.db
 * @param {Boolean} options.nodeWebkitAppName Optional, specify the name of your NW app if you want options.filename to be relative to the directory where
 *                                            Node Webkit stores application data such as cookies and local storage (the best place to store data in my opinion)
 */
function Persistence (options) {
  var self = this;
  this.db = options.db;
  this.inMemoryOnly = this.db.inMemoryOnly;
  this.directoryName = this.db.filename;
  this.model = options.model;
  this.entitySetName = options.entitySetName;
  this.entityType = options.entityType;
  this.resolveFileExtension = options.resolveFileExtension;
  this.syncModifications = options.syncModifications == null ? true : options.syncModifications;
  this.treshold = 500;

  var readyToListenForChanges = false;

  var keys = Object.keys(this.entityType).filter(function (k) {
    return self.entityType[k].publicKey;
  });
  if (keys.length !== 1) {
    throw new Error('Entity set with containsDocuments=true must contain exactly one type property with publicKey=true');
  }

  this.key = keys[0];
  this.collectDocumentProperties();

  // jsreport - we need to have parallel cache with _id index because nedb is removing
  // fist from indexes and then from Persistence. Therefore we would have no way of nowing
  // the document key and would not be able to get correct filename to delete.
  this.dataByIdCache = {};

  Persistence.ensureDirectoryExists(this.directoryName);

  this.lastChange = new Date();

  if (this.syncModifications) {
    this.watcher = chokidar.watch(this.directoryName, {ignorePermissionErrors: true, ignoreInitial: true});

    this.watcher.on('ready', function() {
      readyToListenForChanges = true;
    });

    this.watcher.on('all', function (eventName, filePath) {
      if (!readyToListenForChanges) {
        return;
      }

      // ignore OSX .DS_Store files
      if (path.basename(filePath) === '.DS_Store') {
        return;
      }

      if (Math.abs(new Date() - self.lastChange) > self.treshold) {
        self.loadDatabase(function () {
          self.emit('external-modification');
        });
      }
    });
  }
}

util.inherits(Persistence, events.EventEmitter);

/**
 * Check if a directory exists and create it on the fly if it is not the case
 * cb is optional, signature: err
 */
Persistence.ensureDirectoryExists = function (dir) {
  mkdirp.sync(dir);
};

Persistence.prototype.entryDirectory = function (doc) {
  return path.join(this.directoryName, doc[this.key]);
};

Persistence.prototype.collectDocumentProperties = function () {
  var self = this;
  this.documentProperties = [];

  function deepWalk (type, path) {
    var p = path ? path + '.' : '';
    Object.keys(type).forEach(function (k) {
      if (type[k].document) {
        return self.documentProperties.push({path: p + k, type: type[k]});
      }

      if (type[k].type.indexOf('Edm') !== 0 && type[k].type.indexOf('Collection(') === -1) {
        var complexTypeName = type[k].type.replace(self.model.namespace + '.', '');
        var complexType = self.model.complexTypes[complexTypeName];
        deepWalk(complexType, p + k);
      }
    });
  }

  deepWalk(this.entityType);
};

Persistence.getPropertyValue = function (doc, path) {
  var paths = path.split('.');
  for (var i = 0; i < paths.length && doc; i++) {
    doc = doc[paths[i]];
  }

  return doc;
};

Persistence.deletePropertyValue = function (doc, path) {
  var paths = path.split('.');
  for (var i = 0; i < paths.length && doc; i++) {
    if (i === paths.length - 1) {
      delete doc[paths[i]];
    } else {
      doc = doc[paths[i]];
    }
  }
};

Persistence.setPropertyValue = function (doc, path, val) {
  var paths = path.split('.');
  for (var i = 0; i < paths.length && doc; i++) {
    if (i === paths.length - 1) {
      doc[paths[i]] = val;
    } else {
      doc = doc[paths[i]];
    }
  }
};

/**
 * Persist new state for the given newDocs (can be insertion, update or removal)
 * Use an append-only format
 * @param {Array} newDocs Can be empty if no doc was updated/removed
 * @param {Function} cb Optional, signature: err
 */
Persistence.prototype.persistNewState = function (newDocs, cb) {
  var self = this;
  var callback = cb ||
    function () {
    };

  // In-memory only datastore
  if (self.inMemoryOnly) {
    return callback(null);
  }

  async.eachSeries(newDocs, function (doc, cb) {
    self.lastChange = new Date();

    if (doc.$$deleted) {
      return fs.remove(self.entryDirectory(self.dataByIdCache[doc._id]), function (err) {
        if (err) {
          return cb(err);
        }
        delete self.dataByIdCache[doc._id];
        cb();
      });
    }

    if (!doc[self.key]) {
      self.db.indexes._id.remove(doc);
      return cb(new Error('Document need to have a ' + self.key));
    }

    if (doc[self.key].indexOf('/') !== -1) {
      self.db.indexes._id.remove(doc);
      return cb(new Error('Document cannot contain / in the ' + self.key));
    }

    var samePublicKeyDocs = Object.keys(self.dataByIdCache)
      .map(function (k) {
        return self.dataByIdCache[k];
      })
      .filter(function (d) {
        return d[self.key] === doc[self.key] && d._id !== doc._id;
      });

    if (samePublicKeyDocs.length > 0) {
      self.db.indexes._id.remove(doc);
      return cb(new Error('Duplicated entry for key ' + doc[self.key]));
    }

    var fns = [];
    var previousDoc = self.dataByIdCache[doc._id];
    // key was changed, delete the old directory
    if (previousDoc && previousDoc[self.key] !== doc[self.key]) {
      fns.push(function (cb) {
        fs.remove(self.entryDirectory(previousDoc), cb);
      });
    }

    self.dataByIdCache[doc._id] = doc;
    var entryDirectory = self.entryDirectory(doc);

    fns.push(function(cb) {
      try {
        mkdirp.sync(entryDirectory);
        cb()
      } catch (e) {
        cb(e)
      }
    })

    var docClone = extend(true, {}, doc);
    // save files for full files
    self.documentProperties.forEach(function (prop) {
      fns.push(function (cb) {
        var fileExtension = self.resolveFileExtension(doc, self.entitySetName, self.entityType, prop.type);
        var value = Persistence.getPropertyValue(docClone, prop.path);
        value = value || '';
        if (prop.type.type === 'Edm.Binary' && !Buffer.isBuffer(value)) {
          // object instead of buffer in node 4
          if (typeof value === 'object') {
            value = Object.keys(value).map(function (key) {return value[key]; });
          }

          value = new Buffer(value, 'base64');
        }
        fs.writeFile(path.join(entryDirectory, _.last(prop.path.split('.')) + '.' + fileExtension), value, function (err) {
          if (err) {
            return cb(err);
          }

          if (!previousDoc) {
            return cb();
          }

          var previousExtension = self.resolveFileExtension(previousDoc, self.entitySetName, self.entityType, prop.type);
          if (previousExtension === fileExtension) {
            return cb();
          }

          if (previousDoc[self.key] !== docClone[self.key]) {
            return cb()
          }

          fs.unlink(path.join(entryDirectory, _.last(prop.path.split('.')) + '.' + previousExtension), cb);
        });

        Persistence.deletePropertyValue(docClone, prop.path);
      });
    });

    // save config.json
    fns.push(function (cb) {
      delete docClone[self.key];
      fs.writeFile(path.join(entryDirectory, 'config.json'), Persistence.serialize(docClone), cb);
    });

    async.series(fns, cb);
  }, callback);
};

Persistence.parse = function (rawData) {
  return JSON.parse(rawData, function (k, v) {
    if (k === '$$date') {
      return new Date(v);
    }
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' || v === null) {
      return v;
    }
    if (v && v.$$date) {
      return v.$$date;
    }

    return v;
  });
};

Persistence.prototype.parseEntryDirectory = function (directory, cb) {
  var self = this;
  var doc = {};

  fs.readFile(path.join(directory, 'config.json'), 'utf8', function (err, content) {
    if (err) {
      return cb(new Error('Unable to parse config.json. Database is corrupted or you are trying to use "fs" jsreport' +
        'store provider on the data set created with "nedb" provider. Please switch connection string name to nedb ' +
        'and npm install jsreport-embedded-store \n' +
        err));
    }

    try {
      doc = Persistence.parse(content);
      doc[self.key] = path.basename(directory);
    } catch (e) {
      return cb(e);
    }

    async.each(self.documentProperties, function (prop, cb) {
      glob(path.join(directory, _.last(prop.path.split('.'))) + '.*', function (err, files) {
        if (err) {
          return cb(err);
        }

        if (files.length > 1) {
          return cb(new Error('Multiple files found for entry ' + path.join(directory, _.last(prop.path.split('.')))));
        }

        if (files.length < 1) {
          return cb();
        }

        fs.readFile(files[0], function (err, content) {
          if (err) {
            return cb(err);
          }

          Persistence.setPropertyValue(doc, prop.path, prop.type.type === 'Edm.Binary' ? content : content.toString('utf8'));
          cb();
        });
      });
    }, function (err) {
      cb(err, doc);
    });
  });
};

/**
 * Load the database
 * 1) Create all indexes
 * 2) Insert all data
 * 3) Compact the database
 * This means pulling data out of the data file or creating it if it doesn't exist
 * Also, all data is persisted right away, which has the effect of compacting the database file
 * This operation is very quick at startup for a big collection (60ms for ~10k docs)
 * @param {Function} cb Optional callback, signature: err
 */
Persistence.prototype.loadDatabase = function (cb) {
  this.lastChange = new Date();
  var callback = cb ||
    function () {
    };
  var self = this;

  self.db.resetIndexes();

  if (self.inMemoryOnly) {
    return callback(null);
  }
  Persistence.ensureDirectoryExists(path.dirname(self.directoryName));

  fs.readdir(self.directoryName, function (err, files) {
    if (err) {
      return callback(err);
    }

    var docs = [];
    var docsById = {};
    async.each(files, function (d, cb) {
      // ignore OSX .DS_Store files
      if (d === '.DS_Store') {
        return cb();
      }

      self.parseEntryDirectory(path.join(self.directoryName, d), function (err, doc) {
        if (err) {
          return callback(err);
        }

        docs.push(doc);
        docsById[doc._id] = doc;
        cb();
      });
    }, function (err) {
      if (err) {
        return callback(err);
      }

      // Fill cached database (i.e. all indexes) with data
      try {
        self.db.resetIndexes(docs);
      } catch (e) {
        self.db.resetIndexes();   // Rollback any index which didn't fail
        return callback(e);
      }

      self.dataByIdCache = docsById;
      self.db.executor.processBuffer();

      return callback(null);
    });
  });
};

/**
 * Serialize an object to be persisted to a one-line string
 * For serialization/deserialization, we use the native JSON parser and not eval or Function
 * That gives us less freedom but data entered in the database may come from users
 * so eval and the like are not safe
 * Accepted primitive types: Number, String, Boolean, Date, null
 * Accepted secondary types: Objects, Arrays
 */
Persistence.serialize = function (obj) {
  var res;

  var originalDateToJSON = Date.prototype.toJSON;
  // Keep track of the fact that this is a Date object
  Date.prototype.toJSON = function () {
    return {$$date: this.getTime()};
  };

  res = JSON.stringify(obj, function (k, v) {
    Persistence.checkKey(k, v);

    if (typeof v === undefined) {
      return null;
    }
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' || v === null) {
      return v;
    }

    return v;
  }, 4);

  // Return Date to its original state
  Date.prototype.toJSON = originalDateToJSON;

  return res;
};

/**
 * Check a key, throw an error if the key is non valid
 * @param {String} k key
 * @param {Model} v value, needed to treat the Date edge case
 * Non-treatable edge cases here: if part of the object if of the form { $$date: number } or { $$deleted: true }
 * Its serialized-then-deserialized version it will transformed into a Date object
 * But you really need to want it to trigger such behaviour, even when warned not to use '$' at the beginning of the field names...
 */
Persistence.checkKey = function (k, v) {
  if (k[0] === '$' && !(k === '$$date' && typeof v === 'number') && !(k === '$$deleted' && v === true) && !(k === '$$indexCreated') && !(k === '$$indexRemoved')) {
    throw new Error('Field names cannot begin with the $ character');
  }

  if (k.indexOf('.') !== -1) {
    throw new Error('Field names cannot contain a .');
  }
};

// Interface
module.exports = Persistence;
