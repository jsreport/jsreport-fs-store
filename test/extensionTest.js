const path = require('path')
const should = require('should')
const JsReport = require('jsreport-core')
var IO = require('socket.io-client')

describe('extension use', () => {
  let jsreport

  beforeEach(() => {
    jsreport = JsReport({ store: { provider: 'fs' } })
    jsreport.use(require('../')())
    return jsreport.init()
  })

  afterEach(() => jsreport.close())

  it('should be able apply fs store without store option just with jsreport.use', () => {
    jsreport.documentStore.provider.name.should.be.eql('fs')
  })
})

describe('extension discovery', () => {
  let jsreport

  beforeEach(async () => {
    jsreport = JsReport({
      discover: true,
      extensionsList: ['fs-store'],
      rootDirectory: path.join(__dirname, '../'),
      store: { provider: 'fs' }
    })

    await jsreport.init()
  })

  afterEach(async () => {
    if (jsreport) {
      await jsreport.close()
    }
  })

  it('should find and apply fs store', () => {
    jsreport.documentStore.provider.name.should.be.eql('fs')
  })
}).timeout(10000)

describe('extension disabled through store', () => {
  let jsreport

  beforeEach(() => {
    jsreport = JsReport({
      discover: true,
      extensionsList: ['fs-store'],
      store: { provider: 'memory' },
      rootDirectory: path.join(__dirname, '../')
    })
    return jsreport.init()
  })

  afterEach(() => jsreport.close())

  it('should find and apply fs store', () => {
    should(jsreport.documentStore.provider.name).not.be.eql('fs')
  })
}).timeout(10000)

describe('extension sockets', () => {
  let jsreport
  let io

  beforeEach(() => {
    io = IO('http://localhost:3000')
    jsreport = JsReport({ store: { provider: 'fs' } })
    jsreport.use(require('jsreport-express')({ httpPort: 3000 }))
    jsreport.use(require('../')({ syncModifications: true }))
    return jsreport.init()
  })

  afterEach(() => {
    io.close()
    jsreport.close()
  })

  it('should emit sockets', (done) => {
    io.on('connect', () => jsreport.documentStore.provider.emit('external-modification'))

    io.on('external-modification', () => done())
  })
})
