const path = require('path')
const Persistence = require('../lib/persistence')
const DocumentModel = require('../lib/documentModel')
const sinon = require('sinon')
require('should-sinon')
require('should')

const model = {
  namespace: 'jsreport',
  entitySets: {
    templates: {
      entityType: 'jsreport.TemplateType',
      splitIntoDirectories: true
    },
    reports: {
      entityType: 'jsreport.ReportType',
      splitIntoDirectories: false
    },
    folders: {
      entityType: 'jsreport.FolderType',
      splitIntoDirectories: false
    }
  },
  entityTypes: {
    TemplateType: {
      _id: { type: 'Edm.String', key: true },
      name: { type: 'Edm.String', publicKey: true },
      shortid: { type: 'Edm.String' },
      folder: { type: 'jsreport.FolderRefType' }
    },
    ReportType: {
      _id: { type: 'Edm.String', key: true },
      name: { type: 'Edm.String', publicKey: true }
    },
    FolderType: {
      _id: { type: 'Edm.String', key: true },
      name: { type: 'Edm.String', publicKey: true },
      shortid: { type: 'Edm.String' }
    }
  },
  complexTypes: {
    FolderRefType: {
      shortid: { type: 'Edm.String' }
    }
  }
}

describe('persistence', () => {
  let persistence
  let fs

  beforeEach(async () => {
    fs = {
      init: sinon.mock(),
      load: sinon.mock(),
      stat: sinon.mock(),
      insert: sinon.mock(),
      exists: sinon.mock(),
      update: sinon.mock(),
      remove: sinon.mock(),
      readdir: sinon.mock(),
      mkdir: sinon.mock(),
      rename: sinon.mock(),
      readFile: sinon.mock(),
      appendFile: sinon.mock(),
      writeFile: sinon.mock(),
      lock: sinon.mock(),
      releaseLock: sinon.mock(),
      path: path
    }
    persistence = Persistence({ documentsModel: DocumentModel(model), fs: fs })
  })

  afterEach(async () => {
  })

  it('should call fs.init on load', async () => {
    fs.readdir.twice()
    fs.readdir.returns([])
    await persistence.load()
  })

  it('should call fs.remove on remove', async () => {
    await persistence.remove({ $entitySet: 'templates', name: 'foo' })
    fs.remove.should.be.calledWith('foo')
  })

  it('should use crash safe approach to update doc', async () => {
    fs.rename.twice()
    await persistence.update({ $entitySet: 'templates', name: 'foo', shortid: 'a' }, { $entitySet: 'templates', name: 'foo', shortid: 'b' })
    fs.mkdir.should.be.calledWith('~~foo~foo')
    fs.writeFile.should.be.calledWith(path.join('~~foo~foo', 'config.json'), JSON.stringify({ $entitySet: 'templates', name: 'foo', shortid: 'a' }, null, 4))
    fs.rename.should.be.calledWith(path.join('~foo~foo'), path.join('foo'))
    fs.rename.should.be.calledWith(path.join('~~foo~foo'), path.join('~foo~foo'))
  })

  it('compact should crash safe approach', async () => {
    const documents = { reports: [ { name: 'a' } ] }
    await persistence.compact(documents)
    fs.writeFile.should.be.calledWith('~reports', JSON.stringify({ name: 'a' }) + '\n')
    fs.rename.should.be.calledWith('~reports', 'reports')
  })

  it('should remove inconsistent folders on load', async () => {
    fs.stat.twice()
    fs.readdir.twice()
    fs.readdir.returns(['~~foo~foo'])
    fs.stat.returns({
      isDirectory: () => true,
      isFile: () => false
    })
    await persistence.load()
    fs.remove.should.be.calledWith('~~foo~foo')
  })
})
