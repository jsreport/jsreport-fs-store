var FileSystemStore = require('../lib/fsStore')
var path = require('path')
require('should')

var model = {
  namespace: 'jsreport',
  entityTypes: {
    'UserType': {
      '_id': { 'type': 'Edm.String', key: true },
      'name': { 'type': 'Edm.String', publicKey: true }
    }
  },
  entitySets: {
    'users': {
      entityType: 'jsreport.UserType',
      splitIntoDirectories: true
    }
  }
}

var options = {
  connectionString: { 'name': 'fs' },
  logger: {
    info: function () {
    }, error: function () {
    }, warn: function () {
    }, debug: function () {
    }
  },
  dataDirectory: path.join(__dirname, 'data')
}

describe('fsStore', function () {
  var store

  beforeEach(function (done) {
    options.dataDirectory = path.join(__dirname, 'data', new Date().getTime() + '')
    store = new FileSystemStore(model, options)
    store.init().then(function () {
      done()
    }).catch(done)
  })

  it('insert and query', function (done) {
    store.collection('users').insert({ name: 'test' })
      .then(function () {
        return store.collection('users').find({ name: 'test' }).then(function (res) {
          res.length.should.be.eql(1)
          done()
        })
      }).catch(done)
  })

  it('insert, update, query', function (done) {
    store.collection('users').insert({ name: 'test' })
      .then(function () {
        return store.collection('users').update({ name: 'test' }, { $set: { name: 'test2' } })
      }).then(function () {
        return store.collection('users').find({ name: 'test2' }).then(function (res) {
          res.length.should.be.eql(1)
          done()
        })
      }).catch(done)
  })

  it('insert remove query', function (done) {
    store.collection('users').insert({ name: 'test' })
      .then(function () {
        return store.collection('users').remove({ name: 'test' })
      }).then(function () {
        return store.collection('users').find({ name: 'test' }).then(function (res) {
          res.length.should.be.eql(0)
          done()
        })
      }).catch(done)
  })

  it('insert duplicated key should throw and not be included in the query', function (done) {
    store.collection('users').insert({ name: 'test' })
      .then(function () {
        return store.collection('users').insert({ name: 'test' })
      }).then(function () {
        done(new Error('Should have failed'))
      }).catch(function () {
        return store.collection('users').find({}).then(function (res) {
          res.should.have.length(1)
          done()
        })
      }).catch(done)
  })

  it('insert doc with / in name should throw', function (done) {
    store.collection('users').insert({ name: 'test/aaa' })
      .then(function () {
        done(new Error('Should have failed'))
      }).catch(function (e) {
        console.log(e)
        done()
      })
  })

  it('update doc with / in name should throw', function (done) {
    store.collection('users').insert({ name: 'test' })
      .then(function () {
        return store.collection('users').update({ name: 'test' }, { $set: { name: 'test/test' } }).then(function () {
          done(new Error('Should have failed'))
        })
      }).catch(function (e) {
        console.log(e)
        done()
      })
  })

  it('beforeInsertListeners should be invoked', function (done) {
    var beforeInsertCalled = false
    store.collection('users').beforeInsertListeners.add('test', function (doc) {
      beforeInsertCalled = true
    })

    store.collection('users').insert({ name: 'user1' })
      .then(function () {
        return store.collection('users').find({ name: 'user1' }).then(function () {
          beforeInsertCalled.should.be.ok
          done()
        })
      }).catch(done)
  })

  it('beforeFindListeners should be invoked', function (done) {
    var beforeFindCalled = false
    store.collection('users').beforeFindListeners.add('user2', function (q) {
      beforeFindCalled = true
    })

    store.collection('users').find({ name: 'user2' }).then(function () {
      beforeFindCalled.should.be.ok
      done()
    }).catch(done)
  })

  it('beforeRemoveListeners should be invoked', function (done) {
    var beforeRemoveCalled = false
    store.collection('users').beforeRemoveListeners.add('test', function () {
      beforeRemoveCalled = true
    })

    store.collection('users').remove({ name: 'test' }).then(function () {
      beforeRemoveCalled.should.be.ok
      done()
    }).catch(done)
  })

  it('beforeUpdateListeners should be invoked', function (done) {
    var beforeUpdateCalled = false
    store.collection('users').beforeUpdateListeners.add('test', function () {
      beforeUpdateCalled = true
    })

    store.collection('users').update({ name: 'test' }, { $set: { name: 'test2' } }).then(function () {
      beforeUpdateCalled.should.be.ok
      done()
    }).catch(done)
  })
})

