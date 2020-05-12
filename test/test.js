const Request = require('jsreport-core/lib/render/request')
const DocumentStore = require('jsreport-core/lib/store/documentStore.js')
const SchemaValidator = require('jsreport-core/lib/util/schemaValidator')
const coreStoreTests = require('jsreport-core').tests.documentStore()
const Provider = require('../lib/provider')
const path = require('path')
const Promise = require('bluebird')
const fs = require('fs')
const ncpAsync = Promise.promisify(require('ncp').ncp)
const sinon = require('sinon')
Promise.promisifyAll(fs)
const rimrafAsync = Promise.promisify(require('rimraf'))
const should = require('should')
require('should-sinon')

const AssetType = {
  _id: { type: 'Edm.String', key: true },
  name: { type: 'Edm.String', publicKey: true },
  content: { type: 'Edm.Binary', document: { extension: 'html', content: true } },
  folder: { type: 'jsreport.FolderRefType' }
}

function createDefaultStore () {
  const validator = new SchemaValidator()

  const store = DocumentStore(
    {
      logger: {
        info: () => {},
        error: () => {},
        warn: () => {},
        debug: () => {}
      }
    },
    validator
  )

  return store
}

describe('common core tests', () => {
  let store
  const tmpData = path.join(__dirname, 'tmpData')
  let resolveFileExtension

  beforeEach(async () => {
    resolveFileExtension = () => null
    await rimrafAsync(tmpData)

    store = createDefaultStore()

    coreStoreTests.init(() => store)

    store.registerProvider(
      Provider({
        dataDirectory: tmpData,
        logger: store.options.logger,
        persistence: { provider: 'fs' },
        sync: { provider: 'fs' },
        resolveFileExtension: store.resolveFileExtension.bind(store),
        createError: m => new Error(m)
      })
    )

    store.addFileExtensionResolver(() => resolveFileExtension())

    await store.init()
  })

  afterEach(async () => {
    await store.provider.close()
    await rimrafAsync(tmpData)
  })

  coreStoreTests(() => store)
})

describe('provider', () => {
  let store
  const tmpData = path.join(__dirname, 'tmpData')
  const blobStorageDirectory = path.join(tmpData, 'blobs')
  let resolveFileExtension

  beforeEach(async () => {
    resolveFileExtension = () => null
    await rimrafAsync(tmpData)

    store = createDefaultStore()

    addCommonTypes(store)

    store.registerProvider(
      Provider({
        dataDirectory: tmpData,
        blobStorageDirectory,
        sync: { provider: 'fs' },
        persistence: { provider: 'fs' },
        logger: store.options.logger,
        resolveFileExtension: store.resolveFileExtension.bind(store),
        createError: m => new Error(m)
      })
    )

    store.addFileExtensionResolver(() => resolveFileExtension())

    await store.init()

    fs.mkdirSync(blobStorageDirectory)
  })

  afterEach(async () => {
    await store.provider.close()
    return rimrafAsync(tmpData)
  })

  describe('basic', () => {
    it('remove should delete doc folder', async () => {
      await store.collection('templates').insert({ name: 'test' })
      fs.existsSync(path.join(tmpData, 'test')).should.be.true()
      await store.collection('templates').remove({ name: 'test' })
      fs.existsSync(path.join(tmpData, 'test')).should.be.false()
    })

    it('insert, update to a different name', async () => {
      await store.collection('templates').insert({ name: 'test' })
      await store.collection('templates').update({ name: 'test' }, { $set: { name: 'test2' } })
      const res = await store.collection('templates').find({ name: 'test2' })
      res.length.should.be.eql(1)
    })

    it('insert should use the _id from input', async () => {
      await store.collection('templates').insert({ name: 'test', _id: 'foo' })
      const res = await store.collection('templates').findOne({ name: 'test' })
      res._id.should.be.eql('foo')
    })

    it('find should exclude $entitySet from result', async () => {
      await store.collection('templates').insert({ name: 'test', _id: 'foo' })
      const res = await store.collection('templates').findOne({ name: 'test' })
      should(res.$entitySet).not.be.ok()
    })

    it('updating arrays', async () => {
      await store.collection('templates').insert({ name: 'test', _id: 'foo', scripts: [{ name: 'foo' }] })
      await store.collection('templates').update({ name: 'test' }, { $set: { scripts: [] } })
      const template = JSON.parse(fs.readFileSync(path.join(tmpData, 'test', 'config.json')))
      template.scripts.should.have.length(0)
    })
  })

  describe('folders', () => {
    it('insert folder should create new directory on top', async () => {
      await store.collection('folders').insert({ name: 'test' })
      fs.existsSync(path.join(tmpData, 'test')).should.be.true()
    })

    it('insert folder and nested entity should create nested new directory', async () => {
      await store.collection('folders').insert({ name: 'test', shortid: 'test' })
      await store.collection('templates').insert({ name: 'foo', engine: 'none', recipe: 'html', folder: { shortid: 'test' } })
      fs.existsSync(path.join(tmpData, 'test')).should.be.true()
      fs.existsSync(path.join(tmpData, 'test', 'foo')).should.be.true()
    })

    it('update folder name', async () => {
      await store.collection('folders').insert({ name: 'test', shortid: 'test' })
      await store.collection('folders').update({ name: 'test' }, { $set: { name: 'foo' } })
      fs.existsSync(path.join(tmpData, 'foo')).should.be.true()
      fs.existsSync(path.join(tmpData, 'test')).should.be.false()
    })

    it('deep nested folders and entities', async () => {
      await store.collection('folders').insert({ name: 'a', shortid: 'a' })
      await store.collection('folders').insert({ name: 'b', shortid: 'b', folder: { shortid: 'a' } })
      await store.collection('folders').insert({ name: 'c', shortid: 'c', folder: { shortid: 'b' } })
      await store.collection('templates').insert({ name: 'foo', shortid: 'foo', folder: { shortid: 'c' } })
      fs.existsSync(path.join(tmpData, 'a', 'b', 'c', 'foo')).should.be.true()
    })

    it('rename folder with entities', async () => {
      await store.collection('folders').insert({ name: 'a', shortid: 'a' })
      await store.collection('templates').insert({ name: 'c', shortid: 'c', folder: { shortid: 'a' } })
      await store.collection('folders').update({ name: 'a' }, { $set: { name: 'renamed' } })
      const template = JSON.parse(fs.readFileSync(path.join(tmpData, 'renamed', 'c', 'config.json')))
      template.name.should.be.eql('c')
    })

    it('should create config.json when creating new folders', async () => {
      await store.collection('folders').insert({ name: 'a', shortid: 'a' })
      fs.existsSync(path.join(tmpData, 'a', 'config.json')).should.be.true()
    })

    it('update folder name should not remove the nested entities', async () => {
      await store.collection('folders').insert({ name: 'test', shortid: 'test' })
      await store.collection('templates').insert({ name: 'tmpl', engine: 'none', recipe: 'html', folder: { shortid: 'test' } })
      await store.collection('folders').update({ name: 'test' }, { $set: { name: 'foo' } })
      fs.existsSync(path.join(tmpData, 'foo', 'tmpl')).should.be.true()
    })

    it('remove whole nested folder with entities', async () => {
      await store.collection('folders').insert({ name: 'a', shortid: 'a' })
      await store.collection('folders').insert({ name: 'b', shortid: 'b', folder: { shortid: 'a' } })
      await store.collection('folders').insert({ name: 'c', shortid: 'c', folder: { shortid: 'b' } })
      await store.collection('templates').insert({ name: 'foo', shortid: 'foo', folder: { shortid: 'c' } })
      await store.collection('templates').remove({ name: 'foo' })
      fs.existsSync(path.join(tmpData, 'a', 'b', 'c', 'foo')).should.be.false()
    })
  })

  describe('transactions', () => {
    it('should throw when data modified in the meantime', async () => {
      await store.collection('templates').insert({ name: 'a' })
      const req1 = Request({})
      const req2 = Request({})
      await store.beginTransaction(req1)
      await store.beginTransaction(req2)
      await store.collection('templates').update({ name: 'a' }, { $set: { content: 'foo' } }, req1)
      await store.collection('templates').update({ name: 'a' }, { $set: { content: 'foo2' } }, req2)
      await store.commitTransaction(req1)
      return store.commitTransaction(req2).should.be.rejected()
    })

    it('commit should ~tran and .tran', async () => {
      const req = Request({})
      await store.beginTransaction(req)
      await store.collection('templates').insert({ name: 'a' }, req)
      await store.commitTransaction(req)
      fs.readdirSync(tmpData).filter(d => d.startsWith('~.tran')).should.have.length(0)
      fs.readdirSync(tmpData).filter(d => d.startsWith('.tran')).should.have.length(0)
    })
  })

  describe('document properties', () => {
    it('should be persisted into dedicated files', async () => {
      await store.collection('templates').insert({ name: 'test', content: 'foo' })
      const content = (await fs.readFileAsync(path.join(tmpData, 'test', 'content.html'))).toString()
      content.should.be.eql('foo')
    })

    it('should be persisted with file extension gathered from resolveFileExtension', async () => {
      resolveFileExtension = () => 'txt'
      await store.collection('templates').insert({ name: 'test', content: 'foo' })
      const content = (await fs.readFileAsync(path.join(tmpData, 'test', 'content.txt'))).toString()
      content.should.be.eql('foo')
    })

    it('should not be duplicated in the config file', async () => {
      await store.collection('templates').insert({ name: 'test', content: 'foo' })
      const config = JSON.parse((await fs.readFileAsync(path.join(tmpData, 'test', 'config.json'))).toString())
      should(config.content).not.be.ok()
    })

    it('should not write dedicated files is prop not defined', async () => {
      await store.collection('templates').insert({ name: 'test', content: 'foo' })
      fs.existsSync(path.join(tmpData, 'templates', 'test', 'header.html')).should.be.false()
    })

    it('should delete dedicated files for null set', async () => {
      await store.collection('templates').insert({ name: 'test', content: 'foo', phantom: { header: 'a' } })
      fs.existsSync(path.join(tmpData, 'test', 'header.html')).should.be.true()
      await store.collection('templates').update({ name: 'test' }, { $set: { phantom: null } })
      fs.existsSync(path.join(tmpData, 'test', 'header.html')).should.be.false()
    })
  })

  describe('validations', () => {
    it('insert doc with / in name should throw', async () => {
      try {
        await store.collection('templates').insert({ name: 'test/aaa' })
        throw new Error('Should have failed')
      } catch (e) {
        if (e.message === 'Should have failed') {
          throw e
        }
      }
    })

    it('update doc with / in name should throw', async () => {
      await store.collection('templates').insert({ name: 'test' })
      try {
        await store.collection('templates').update({ name: 'test' }, { $set: { name: 'test/test' } })
        throw new Error('Should have failed')
      } catch (e) {
        if (e.message === 'Should have failed') {
          throw e
        }
      }
    })

    it('insert duplicated key should throw and not be included in the query', async () => {
      await store.collection('templates').insert({ name: 'test' })
      try {
        await store.collection('templates').insert({ name: 'test' })
        throw new Error('Should have failed')
      } catch (e) {
        if (e.message === 'Should have failed' || !e.message.includes('Duplicate')) {
          throw e
        }
      }

      const res = await store.collection('templates').find({})
      res.should.have.length(1)
    })
  })

  describe('files monitoring', () => {
    it('should fire reload event on file changes', async () => {
      await store.collection('templates').insert({ name: 'test', recipe: 'foo' })
      return new Promise(resolve => {
        store.provider.sync.subscribe(e => {
          e.action.should.be.eql('reload')
          resolve()
        })
        fs.writeFileSync(path.join(tmpData, 'foo.ff'), 'changing')
      })
    })

    it('should not fire reload for common cud operations', async () => {
      let notified = null
      store.provider.sync.subscribe(e => (notified = e))

      await store.collection('templates').insert({ name: 'test', recipe: 'foo' })
      await store.collection('templates').update({ name: 'test' }, { $set: { content: 'changed' } })
      await store.collection('templates').remove({ name: 'test' })

      return Promise.delay(1000).then(() => {
        should(notified).be.null()
      })
    })

    it('should not fire reload for update', async () => {
      let notified = null
      store.provider.sync.subscribe(e => (notified = e))
      await store.collection('templates').insert({ name: 'test', recipe: 'foo', content: 'a' })
      await store.collection('templates').update({ name: 'test' }, { $set: { content: 'changed' } })

      return Promise.delay(1000).then(() => {
        should(notified).be.null()
      })
    })

    it('should debounce reload events', async () => {
      await store.collection('templates').insert({ name: 'test', recipe: 'foo' })
      let reloadCount = 0
      store.provider.sync.subscribe(e => reloadCount++)
      fs.writeFileSync(path.join(tmpData, 'a.ff'), 'changing')
      fs.writeFileSync(path.join(tmpData, 'b.ff'), 'changing')
      fs.writeFileSync(path.join(tmpData, 'c.ff'), 'changing')
      return Promise.delay(1000).then(() => {
        reloadCount.should.be.eql(1)
      })
    })

    it('should not fire reload for changes in pressure', async () => {
      let notified = null
      store.provider.sync.subscribe(e => (notified = e))

      const promises = []
      for (let i = 0; i < 100; i++) {
        promises.push((async () => {
          await store.collection('templates').insert({ name: 'test' + i, recipe: 'foo' })
          return store.collection('templates').update({ name: 'test' + i, recipe: 'foo' }, { $set: { recipe: 'foo2' } })
        })())
      }
      await Promise.all(promises)

      return Promise.delay(1000).then(() => {
        should(notified).be.null()
      })
    })

    it('should not fire reload for settings changes', async () => {
      let notified = null
      store.provider.sync.subscribe(e => (notified = e))
      await store.collection('settings').insert({ key: 'a', value: 'b' })
      await store.collection('settings').update({ key: 'a' }, { $set: { value: 'c' } })

      return Promise.delay(1000).then(() => {
        should(notified).be.null()
      })
    })

    it('should fire reload when a custom folder added', async () => {
      return new Promise(resolve => {
        store.provider.sync.subscribe(e => {
          e.action.should.be.eql('reload')
          resolve()
        })
        fs.mkdirSync(path.join(tmpData, 'myCustomFolder'))
      })
    })

    it('should not fire reload for changes in the blob storage', async () => {
      let notified = null
      store.provider.sync.subscribe(e => (notified = e))
      fs.writeFileSync(path.join(blobStorageDirectory, 'file.txt'), 'aaa')
      return Promise.delay(1000).then(() => {
        should(notified).be.null()
      })
    })

    it('should not fire reload for flat files compaction', async () => {
      let notified = null
      store.provider.sync.subscribe(e => (notified = e))
      await store.collection('settings').insert({ key: 'a', value: 'b' })
      await store.collection('settings').update({ key: 'a' }, { $set: { value: 'c' } })
      await store.provider.persistence.compact(store.provider.transaction.getCurrentDocuments())

      return Promise.delay(1000).then(() => {
        should(notified).be.null()
      })
    })
  })

  describe('queueing', () => {
    // otherwise we get queuing called from the sync reload action
    beforeEach(() => store.provider.close())

    it('insert should go to queue', async () => {
      store.provider.transaction = { operation: sinon.mock(), close: () => {} }
      await store.collection('templates').insert({ name: 'test' })
      store.provider.transaction.operation.should.be.called()
    })

    it('remove should go to queue', async () => {
      await store.collection('templates').insert({ name: 'test' })
      store.provider.transaction = { operation: sinon.mock(), close: () => {} }
      await store.collection('templates').remove({ name: 'test' })
      store.provider.transaction.operation.should.be.called()
    })

    it('update should go to queue', async () => {
      await store.collection('templates').insert({ name: 'test' })
      store.provider.transaction = { operation: sinon.mock(), close: () => {} }
      await store.collection('templates').update({ name: 'test' }, { $set: { recipe: 'foo' } })
      store.provider.transaction.operation.should.be.called()
    })
  })

  describe('syncing', () => {
    // stop default monitoring and use mocks instead
    beforeEach(() => store.provider.close())

    it('insert should publish event', async () => {
      store.provider.sync.publish = sinon.spy()
      const doc = await store.collection('templates').insert({ name: 'test' })
      store.provider.sync.publish.should.be.alwaysCalledWithMatch({ action: 'insert', doc: doc })
    })

    it('insert should publish refresh event if message big', async () => {
      store.provider.sync.publish = sinon.spy()
      store.provider.sync.messageSizeLimit = 1
      const doc = await store.collection('templates').insert({ name: 'test' })
      store.provider.sync.publish.should.be.alwaysCalledWithMatch({
        action: 'refresh',
        doc: { _id: doc._id, $entitySet: 'templates', name: 'test' }
      })
    })

    it('update should publish event', async () => {
      const doc = await store.collection('templates').insert({ name: 'test' })
      store.provider.sync.publish = sinon.spy()
      await store.collection('templates').update({ name: 'test' }, { $set: { recipe: 'foo' } })
      doc.recipe = 'foo'
      store.provider.sync.publish.should.be.alwaysCalledWithMatch({ action: 'update', doc: doc })
    })

    it('insert should publish refresh event if message big', async () => {
      const doc = await store.collection('templates').insert({ name: 'test' })
      store.provider.sync.publish = sinon.spy()
      store.provider.sync.messageSizeLimit = 1
      await store.collection('templates').update({ name: 'test' }, { $set: { name: 'foo' } })
      store.provider.sync.publish.should.be.alwaysCalledWithMatch({
        action: 'refresh',
        doc: { _id: doc._id, $entitySet: 'templates', name: 'foo' }
      })
    })

    it('remove should publish event', async () => {
      const doc = await store.collection('templates').insert({ name: 'test' })
      store.provider.sync.publish = sinon.spy()
      await store.collection('templates').remove({ name: 'test' })
      store.provider.sync.publish.should.be.alwaysCalledWithMatch({ action: 'remove', doc: { $entitySet: doc.$entitySet, _id: doc._id } })
    })

    it('subscribed insert event should insert doc', async () => {
      await store.provider.sync.subscription({
        action: 'insert',
        doc: { _id: 'a', name: 'foo', $entitySet: 'templates' }
      })
      const templates = await store.collection('templates').find({ _id: 'a' })
      templates.should.have.length(1)
      templates[0].name.should.be.eql('foo')
    })

    it('subscribed update event should update doc', async () => {
      const doc = await store.collection('templates').insert({ name: 'test' })
      doc.name = 'foo'
      await store.provider.sync.subscription({
        action: 'update',
        doc: doc
      })
      const templates = await store.collection('templates').find({ _id: doc._id })
      templates.should.have.length(1)
      templates[0].name.should.be.eql('foo')
    })

    it('subscribed update event should insert doc if not found', async () => {
      const doc = { _id: 'a', name: 'a', $entitySet: 'templates' }
      await store.provider.sync.subscription({
        action: 'update',
        doc: doc
      })
      const templates = await store.collection('templates').find({ _id: doc._id })
      templates.should.have.length(1)
      templates[0].name.should.be.eql('a')
    })

    it('subscribed remove event should remove doc', async () => {
      const doc = await store.collection('templates').insert({ name: 'test' })
      await store.provider.sync.subscription({
        action: 'remove',
        doc: doc
      })
      const templates = await store.collection('templates').find({ _id: doc._id })
      templates.should.have.length(0)
    })

    it('subscribed refresh event should reload new doc', async () => {
      store.provider.persistence.reload = doc => doc

      await store.provider.sync.subscription({
        action: 'refresh',
        doc: { _id: 'a', name: 'foo', $entitySet: 'templates' }
      })

      const templates = await store.collection('templates').find({ _id: 'a' })
      templates.should.have.length(1)
      templates[0].name.should.be.eql('foo')
    })

    it('subscribed refresh event should reload existing doc', async () => {
      const doc = await store.collection('templates').insert({ name: 'test' })
      store.provider.persistence.reload = d => Object.assign({}, d, { name: 'foo' })

      await store.provider.sync.subscription({
        action: 'refresh',
        doc: doc
      })

      const templates = await store.collection('templates').find({ _id: doc._id })
      templates.should.have.length(1)
      templates[0].name.should.be.eql('foo')
    })
  })

  describe('flat files', () => {
    it('insert should create flat file store', async () => {
      const doc = await store.collection('settings').insert({ key: 'a', value: '1' })
      fs.existsSync(path.join(tmpData, 'settings')).should.be.true()
      const readDoc = JSON.parse(fs.readFileSync(path.join(tmpData, 'settings')).toString())
      readDoc._id.should.be.eql(doc._id)
      readDoc.key.should.be.eql(doc.key)
      readDoc.value.should.be.eql(doc.value)
    })

    it('update should append to file new entry', async () => {
      await store.collection('settings').insert({ key: 'a', value: '1' })
      await store.collection('settings').update({ key: 'a' }, { $set: { value: '2' } })
      const docs = fs
        .readFileSync(path.join(tmpData, 'settings'))
        .toString()
        .split('\n')
        .filter(c => c)
        .map(JSON.parse)
      docs.should.have.length(2)
      docs[0].value.should.be.eql('1')
      docs[1].value.should.be.eql('2')
    })

    it('remove should append $$delete', async () => {
      await store.collection('settings').insert({ key: 'a', value: '1' })
      await store.collection('settings').remove({ key: 'a' })
      const docs = fs
        .readFileSync(path.join(tmpData, 'settings'))
        .toString()
        .split('\n')
        .filter(c => c)
        .map(JSON.parse)
      docs.should.have.length(2)
      docs[1].$$deleted.should.be.true()
    })
  })
})

describe('load', () => {
  let store

  beforeEach(async () => {
    store = createDefaultStore()

    addCommonTypes(store)

    store.registerProvider(
      Provider({
        dataDirectory: path.join(__dirname, 'data'),
        logger: store.options.logger,
        persistence: { provider: 'fs' },
        sync: { provider: 'fs' },
        resolveFileExtension: store.resolveFileExtension.bind(store),
        createError: m => new Error(m)
      })
    )

    await store.init()
  })

  afterEach(() => {
    return store.provider.close()
  })

  it('should load templates splitted into folder', async () => {
    const res = await store.collection('templates').find({})
    res.should.have.length(1)
    res[0].name.should.be.eql('Invoice')
    res[0].recipe.should.be.eql('phantom-pdf')
    res[0].content.should.be.eql('content')
    res[0].phantom.margin.should.be.eql('margin')
    res[0].phantom.header.should.be.eql('header')
    res[0].modificationDate.should.be.an.instanceOf(Date)
  })

  it('should load settings from flat file', async () => {
    const res = await store
      .collection('settings')
      .find({})
      .sort({ key: 1 })
    res.should.have.length(2)
    res[0].key.should.be.eql('a')
    res[1].key.should.be.eql('b')
    res[0].value.should.be.eql('1')
  })

  it('should load assets binary content', async () => {
    const res = await store.collection('assets').find({ name: 'image.png' })
    res.should.have.length(1)
    res[0].content.should.be.instanceof(Buffer)
  })

  it('should load folders as entities', async () => {
    const res = await store.collection('folders').find({})
    res.should.have.length(3)
    const assets = res.find(r => r.name === 'assets')
    assets.should.be.ok()
    assets.shortid.should.be.eql('1jpybw')

    const invoice = await store.collection('templates').findOne({})
    invoice.folder.shortid.should.be.eql('Q4EEHA')
  })

  it('should not load folder config.json as asset', async () => {
    const res = await store.collection('assets').findOne({ name: 'config.json' })
    should(res).be.null()
  })
})

describe('load cleanup', () => {
  let store

  beforeEach(async () => {
    await rimrafAsync(path.join(__dirname, 'dataToCleanupCopy'))
    await ncpAsync(path.join(__dirname, 'dataToCleanup'), path.join(__dirname, 'dataToCleanupCopy'))

    store = createDefaultStore()

    addCommonTypes(store)

    store.registerProvider(
      Provider({
        dataDirectory: path.join(__dirname, 'dataToCleanupCopy'),
        logger: store.options.logger,
        persistence: { provider: 'fs' },
        sync: { provider: 'fs' },
        resolveFileExtension: store.resolveFileExtension.bind(store),
        createError: m => new Error(m)
      })
    )
    await store.init()
  })

  afterEach(async () => {
    await rimrafAsync(path.join(__dirname, 'dataToCleanupCopy'))
    return store.provider.close()
  })

  it('should load commited changes ~c~c', async () => {
    const res = await store.collection('templates').find({})
    res.should.have.length(1)
    res[0].name.should.be.eql('c')
    res[0].content.should.be.eql('changed')
  })

  it('should remove uncommited changes ~~a', () => {
    fs.existsSync(path.join(__dirname, 'dataToCleanupCopy', 'templates', '~~a')).should.be.false()
  })

  it('should remove commited and renamed changes', () => {
    fs.existsSync(path.join(__dirname, 'dataToCleanupCopy', 'templates', '~c~c')).should.be.false()
  })

  it('should compact flat files on load', () => {
    fs.readFileSync(path.join(__dirname, 'dataToCleanupCopy', 'settings'), 'utf8').should.not.containEql('"value":"1"')
  })
})

describe('load cleanup consistent transaction', () => {
  let store

  beforeEach(async () => {
    await rimrafAsync(path.join(__dirname, 'tranDataToCleanupCopy'))
    await ncpAsync(path.join(__dirname, 'tranConsistentDataToCleanup'), path.join(__dirname, 'tranDataToCleanupCopy'))

    store = createDefaultStore()

    addCommonTypes(store)

    store.registerProvider(
      Provider({
        dataDirectory: path.join(__dirname, 'tranDataToCleanupCopy'),
        logger: store.options.logger,
        persistence: { provider: 'fs' },
        sync: { provider: 'fs' },
        resolveFileExtension: store.resolveFileExtension.bind(store),
        createError: m => new Error(m)
      })
    )
    await store.init()
  })

  afterEach(async () => {
    await rimrafAsync(path.join(__dirname, 'tranDataToCleanupCopy'))
    return store.provider.close()
  })

  it('should remove ~.tran and .tran and copy ~.tran to root', () => {
    fs.existsSync(path.join(__dirname, 'tranDataToCleanupCopy', '~.tran')).should.be.false()
    fs.existsSync(path.join(__dirname, 'tranDataToCleanupCopy', '.tran')).should.be.false()
    fs.existsSync(path.join(__dirname, 'tranDataToCleanupCopy', 'b')).should.be.true()
  })
})

describe('load cleanup inconsistent transaction', () => {
  let store

  beforeEach(async () => {
    await rimrafAsync(path.join(__dirname, 'tranDataToCleanupCopy'))
    await ncpAsync(path.join(__dirname, 'tranInconsistentDataToCleanup'), path.join(__dirname, 'tranDataToCleanupCopy'))

    store = createDefaultStore()

    addCommonTypes(store)

    store.registerProvider(
      Provider({
        dataDirectory: path.join(__dirname, 'tranDataToCleanupCopy'),
        logger: store.options.logger,
        persistence: { provider: 'fs' },
        sync: { provider: 'fs' },
        resolveFileExtension: store.resolveFileExtension.bind(store),
        createError: m => new Error(m)
      })
    )
    await store.init()
  })

  afterEach(async () => {
    await rimrafAsync(path.join(__dirname, 'tranDataToCleanupCopy'))
    return store.provider.close()
  })

  it('should remove ~.tran and dont copy to root', () => {
    fs.existsSync(path.join(__dirname, 'tranDataToCleanupCopy', '~.tran')).should.be.false()
    fs.existsSync(path.join(__dirname, 'tranDataToCleanupCopy', 'b')).should.be.false()
  })
})

function addCommonTypes (store) {
  store.registerEntityType('FolderType', {
    _id: { type: 'Edm.String', key: true },
    name: { type: 'Edm.String', publicKey: true },
    shortid: { type: 'Edm.String' },
    creationDate: { type: 'Edm.DateTimeOffset' },
    modificationDate: { type: 'Edm.DateTimeOffset' }
  })

  store.registerComplexType('ScriptType', {
    name: { type: 'Edm.String', publicKey: true }
  })

  store.registerComplexType('FolderRefType', {
    shortid: { type: 'Edm.String' }
  })

  store.registerComplexType('PhantomType', {
    margin: { type: 'Edm.String' },
    header: { type: 'Edm.String', document: { extension: 'html', engine: true } }
  })

  store.registerEntityType('TemplateType', {
    _id: { type: 'Edm.String', key: true },
    name: { type: 'Edm.String', publicKey: true },
    content: { type: 'Edm.String', document: { extension: 'html', engine: true } },
    recipe: { type: 'Edm.String' },
    modificationDate: { type: 'Edm.DateTimeOffset' },
    phantom: { type: 'jsreport.PhantomType', schema: { type: 'null' } },
    folder: { type: 'jsreport.FolderRefType' },
    scripts: { type: 'Collection(jsreport.ScriptType)' }
  })
  store.registerEntitySet('templates', { entityType: 'jsreport.TemplateType', splitIntoDirectories: true })

  store.registerEntityType('AssetType', AssetType)
  store.registerEntitySet('assets', { entityType: 'jsreport.AssetType', splitIntoDirectories: true })

  store.registerEntityType('SettingsType', {
    _id: { type: 'Edm.String', key: true },
    key: { type: 'Edm.String' },
    value: { type: 'Edm.String' }
  })

  store.registerEntitySet('settings', { entityType: 'jsreport.SettingsType' })

  store.registerEntitySet('folders', { entityType: 'jsreport.FolderType', splitIntoDirectories: true })
}
