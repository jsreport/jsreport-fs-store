var should = require('should');
var Persistence = require('../lib/persistence.js');
var path = require('path');
var fs = require('fs-extra');
var Datastore = require('nedb');

describe('persistence', function () {
  var db;
  var persistence;
  var dataPath = path.join(__dirname, 'data');
  var templatesPath = path.join(dataPath, 'templates');

  var model = {
    namespace: 'jsreport',
    entityTypes: {
      'TemplateType': {
        '_id': {'type': 'Edm.String', key: true},
        'name': {'type': 'Edm.String', publicKey: true},
        'html': {'type': 'Edm.String', document: {extension: 'html'}}
      }
    },
    entitySets: {
      'templates': {
        entityType: 'jsreport.TemplateType'
      }
    }
  };

  beforeEach(function () {
    deleteFilesSync(dataPath);

    db = new Datastore({
      filename: path.join(dataPath, 'templates'),
      autoload: false, inMemoryOnly: false
    });
    persistence = new Persistence({
      db: db,
      model: model,
      entitySetName: 'templates',
      entityType: model.entityTypes.TemplateType,
      resolveFileExtension: function (doc, entitySetName, entityType, propType) {
        return propType.document.extension;
      }
    });
  });

  afterEach(function () {
    persistence.watcher.close();
  });

  it('should work on empty database', function (done) {
    persistence.loadDatabase(function (err) {
      if (err) {
        return done(err);
      }

      done();
    });
  });

  it('persistNewState should correctly write config.json and document files', function (done) {
    persistence.persistNewState([{
      name: 'test template',
      html: 'kuk',
      attr: 'foo',
      _id: 'id'
    }], function (err) {
      if (err) {
        return done(err);
      }

      var configjs = fs.readFileSync(path.join(templatesPath, 'test template', 'config.json'));
      var config = JSON.parse(configjs);
      config.attr.should.be.eql('foo');
      should(config.html).not.be.ok;

      var content = fs.readFileSync(path.join(templatesPath, 'test template', 'html.html')).toString();
      content.should.be.eql('kuk');
      done();
    });
  });

  it('persistNewState should write empty string for null or undefined document property', function (done) {
    persistence.persistNewState([{
      name: 'test template',
      html: null,
      attr: 'foo',
      _id: 'id'
    }], function (err) {
      if (err) {
        return done(err);
      }
      var content = fs.readFileSync(path.join(templatesPath, 'test template', 'html.html')).toString();
      content.should.be.eql('');
      done();
    });
  });

  it('public key should be excluded the config.json', function (done) {
    persistence.persistNewState([{
      name: 'test template',
      html: null,
      attr: 'foo',
      _id: 'id'
    }], function (err) {
      if (err) {
        return done(err);
      }
      var content = fs.readFileSync(path.join(templatesPath, 'test template', 'config.json')).toString();
      should(JSON.parse(content).name).be.undefined();

      persistence.loadDatabase(function (err) {
        if (err) {
          done(err);
        }

        persistence.dataByIdCache['id'].name.should.be.eql('test template');
        done();
      });
    });
  });

  it('persistNewState should rename directory when key changed', function (done) {
    persistence.persistNewState([{
      name: 'first',
      _id: 'id'
    }], function (err) {
      if (err) {
        return done(err);
      }

      persistence.persistNewState([{
        name: 'changed',
        _id: 'id'
      }], function (err) {
        if (err) {
          return done(err);
        }

        fs.existsSync(path.join(templatesPath, 'changed')).should.be.eql(true);
        fs.existsSync(path.join(templatesPath, 'first')).should.be.eql(false);
        done();
      });
    });
  });

  it('loadDatabase shouldLoad persisted state', function (done) {
    persistence.persistNewState([{
      name: 'name',
      html: 'content',
      _id: 'id'
    }], function () {
      persistence.loadDatabase(function (err) {
        if (err) {
          return done(err);
        }

        persistence.dataByIdCache['id'].html.should.be.eql('content');

        done();
      });
    });
  });

  it('should dynamically resolve file extensions when persisting', function (done) {
    persistence.resolveFileExtension = function (doc, entityType) {
      return 'foo';
    };

    persistence.persistNewState([{
      name: 'name',
      html: 'content',
      _id: 'id'
    }], function (err) {
      if (err) {
        return done(err);
      }

      fs.existsSync(path.join(templatesPath, 'name', 'html.foo')).should.be.eql(true);
      done();
    });
  });

  it('should delete file with old file extension when changed', function (done) {
    persistence.resolveFileExtension = function (doc, entityType) {
      return doc.html;
    };

    persistence.persistNewState([{
      name: 'name',
      html: 'a',
      _id: 'id'
    }], function (err) {
      if (err) {
        return done(err);
      }

      persistence.persistNewState([{
        name: 'name',
        html: 'b',
        _id: 'id'
      }], function (err) {
        if (err) {
          return done(err);
        }

        fs.existsSync(path.join(templatesPath, 'name', 'html.b')).should.be.eql(true);
        fs.existsSync(path.join(templatesPath, 'name', 'html.a')).should.be.eql(false);
        done();
      });
    });
  });

  it('persistNewState should delete the folder when state $$$delete', function (done) {
    persistence.resolveFileExtension = function (doc, entityType) {
      return 'foo';
    };

    persistence.persistNewState([{
      name: 'name',
      html: 'content',
      _id: 'id'
    }, {
      _id: 'id',
      '$$deleted': true
    }], function (err) {
      if (err) {
        return done(err);
      }

      fs.existsSync(path.join(templatesPath, 'name', 'html.foo')).should.be.eql(false);
      done();
    });
  });

  it('persistNewState should callback error when inserting duplicate public key', function (done) {
    persistence.resolveFileExtension = function (doc, entityType) {
      return 'foo';
    };

    persistence.persistNewState([{
      name: 'name',
      html: 'content',
      _id: 'id'
    }, {
      name: 'name',
      html: 'content',
      _id: 'id2'
    }], function (err) {
      if (err) {
        return done();
      }

      done(new Error('Public key uniqueness error should be thrown'));
    });
  });

  it('should watch for changes and reload if required', function (done) {
    persistence.treshold = 50;
    persistence.persistNewState([{
      name: 'name',
      html: 'content',
      _id: 'id'
    }], function (err) {
      if (err) {
        return done(err);
      }

      setTimeout(function () {
        fs.writeFileSync(path.join(templatesPath, 'name', 'html.html'), 'another');
      }, 50);

      setTimeout(function () {
        persistence.dataByIdCache['id'].html.should.be.eql('another');
        done();
      }, 200);
    });
  });

  it('persistNewState should write document files also for the nested properties', function (done) {
    persistence.model.entityTypes.TemplateType.phantom = {type: 'jsreport.PhantomType'};
    persistence.model.complexTypes = {
      PhantomType: {
        header: {type: 'Edm.String', document: {extension: 'html'}}
      }
    };
    persistence.collectDocumentProperties();

    persistence.persistNewState([{
      name: 'test template',
      html: 'kuk',
      attr: 'foo',
      _id: 'id',
      phantom: {
        header: 'header'
      }
    }], function (err) {
      if (err) {
        return done(err);
      }

      fs.existsSync(path.join(templatesPath, 'test template', 'header.html')).should.be.eql(true);
      done();
    });
  });

  it('loadDatabase should callback error when the parsing fails', function (done) {
    fs.mkdirSync(path.join(templatesPath, 'test template'));
    fs.writeFileSync(path.join(templatesPath, 'test template', 'config.json'), 'an invalid json');

    persistence.loadDatabase(function (err) {
      if (err) {
        return done();
      }

      done('Should have failed');
    });
  });

  it('loadDatabase should ignore documents if the parent object does not exist in the config.json', function (done) {
    persistence.persistNewState([{
      name: 'test template',
      html: 'kuk',
      attr: 'foo',
      _id: 'id',
      phantom: {
        header: 'header'
      }
    }], function (err) {
      if (err) {
        return done(err);
      }

      fs.writeFileSync(path.join(templatesPath, 'test template', 'config.json'), JSON.stringify({
        name: 'test template',
        html: 'kuk',
        attr: 'foo',
        _id: 'id'
      }));

      persistence.loadDatabase(function (err) {
        if (err) {
          return done(err);
        }

        done();
      });
    });
  });

  it('loadDatabase should read document files with binary types', function (done) {
    persistence.model.entityTypes.TemplateType.image = {type: 'Edm.Binary', document: {extension: 'png'}};
    persistence.collectDocumentProperties();

    persistence.persistNewState([{
      name: 'test template',
      html: 'kuk',
      image: 'aaa',
      _id: 'id'
    }], function (err) {
      if (err) {
        return done(err);
      }

      persistence.loadDatabase(function (err) {
        if (err) {
          return done(err);
        }

        persistence.dataByIdCache['id'].image.should.be.instanceOf(Buffer);
        done();
      });
    });
  });

  function deleteFilesSync (path) {
    try {
      var files = fs.readdirSync(path);

      if (files.length > 0) {
        for (var i = 0; i < files.length; i++) {
          var filePath = path + '/' + files[i];
          if (fs.statSync(filePath).isFile()) {
            fs.unlinkSync(filePath);
          } else {
            deleteFilesSync(filePath);
          }
        }
      }
      fs.rmdirSync(path);
    } catch (e) {
      return;
    }
  }
});
