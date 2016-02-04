var FileSystemStore = require('../lib/fsStore');
var path = require('path');
var fs = require('fs-extra');
require('should');

var model = {
  namespace: 'jsreport',
  entityTypes: {
    'UserType': {
      '_id': {'type': 'Edm.String', key: true},
      'name': {'type': 'Edm.String', publicKey:true}
    }
  },
  entitySets: {
    'users': {
      entityType: 'jsreport.UserType',
      splitIntoDirectories: true
    }
  }
};

var options = {
  connectionString: {'name': 'fs'},
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
    options.dataDirectory = path.join(__dirname, 'data', new Date().getTime() + '');
    store = new FileSystemStore(model, options);
    store.init().then(function () {
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

  it('insert duplicated key should throw and not be included in the query', function (done) {
    store.collection('users').insert({name: 'test'})
        .then(function () {
          return store.collection('users').insert({name: 'test'})
        }).then(function () {
          done(new Error('Should have failed'))
        }).catch(function() {
          return store.collection('users').find({}).then(function(res) {
            res.should.have.length(1)
            done()
          })
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
