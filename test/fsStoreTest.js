var FileSystemStore = require('../lib/fsStore');
var path = require('path');
var model = {
  namespace: 'jsreport',
  entityTypes: {
    'UserType': {
      '_id': {'type': 'Edm.String', key: true},
      'name': {'type': 'Edm.String'}
    }
  },
  entitySets: {
    'users': {
      entityType: 'jsreport.UserType'
    }
  }
};

var options = {
  connectionString: {'name': 'fs', inMemory: true},
  logger: {
    info: function () {
    }, error: function () {
    }, warn: function () {
    }, debug: function () {
    }
  },
  dataDirectory: path.join(__dirname, 'data')
};

describe('fsStore', function () {
  var store;

  beforeEach(function (done) {
    store = new FileSystemStore(model, options);
    store.init().then(function () {
      return store.drop();
    }).then(function () {
      done();
    }).catch(done);
  });

  it('insert and query', function (done) {
    store.collection('users').insert({name: 'test'})
        .then(function () {
          return store.collection('users').find({name: 'test'}).then(function (res) {
            res.length.should.be.eql(1);
            done();
          });
        }).catch(done);
  });

  it('insert, update, query', function (done) {
    store.collection('users').insert({name: 'test'})
        .then(function () {
          return store.collection('users').update({name: 'test'}, {$set: {name: 'test2'}});
        }).then(function () {
          return store.collection('users').find({name: 'test2'}).then(function (res) {
            res.length.should.be.eql(1);
            done();
          });
        }).catch(done);
  });

  it('insert remove query', function (done) {
    store.collection('users').insert({name: 'test'})
        .then(function () {
          return store.collection('users').remove({name: 'test'});
        }).then(function () {
          return store.collection('users').find({name: 'test'}).then(function (res) {
            res.length.should.be.eql(0);
            done();
          });
        }).catch(done);
  });

  it('beforeInsertListeners should be invoked', function (done) {
    store.collection('users').beforeInsertListeners.add('test', function () {
      done();
    });

    store.collection('users').insert({name: 'test'})
        .then(function () {
          return store.collection('users').find({name: 'test'});
        }).catch(done);
  });

  it('beforeFindListeners should be invoked', function (done) {
    store.collection('users').beforeFindListeners.add('test', function () {
      done();
    });

    store.collection('users').find({name: 'test'}).catch(done);
  });

  it('beforeRemoveListeners should be invoked', function (done) {
    store.collection('users').beforeRemoveListeners.add('test', function () {
      done();
    });

    store.collection('users').remove({name: 'test'}).catch(done);
  });

  it('beforeUpdateListeners should be invoked', function (done) {
    store.collection('users').beforeUpdateListeners.add('test', function () {
      done();
    });

    store.collection('users').update({name: 'test'}, {$set: {name: 'test2'}}).catch(done);
  });
});
