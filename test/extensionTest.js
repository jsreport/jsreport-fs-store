const path = require('path')
const should = require('should')
const JsReport = require('jsreport-core')
var IO = require('socket.io-client')

describe('extension use', () => {
  let jsreport

  beforeEach(() => {
    jsreport = JsReport()
    jsreport.use(require('../')())
    return jsreport.init()
  })

  afterEach(() => {
    jsreport.close()
  })

  it('should be able apply fs store without connectionString just with jsreport.use', () => {
    jsreport.documentStore.provider.name.should.be.eql('fs')
  })
})

describe('extension discovery', () => {
  let jsreport

  beforeEach(() => {
    jsreport = JsReport({
      discover: true,
      extensions: ['fs-store'],
      rootDirectory: path.join(__dirname, '../'),
      connectionString: { name: 'fs' }
    })
    return jsreport.init()
  })

  afterEach(() => jsreport.close())

  it('should find and apply fs store', () => {
    jsreport.documentStore.provider.name.should.be.eql('fs')
  })
}).timeout(10000)

describe('extension disabled through connectionString', () => {
  let jsreport

  beforeEach(() => {
    jsreport = JsReport({
      discover: true,
      extensions: ['fs-store'],
      connectionString: { name: 'memory' },
      rootDirectory: path.join(__dirname, '../')
    })
    return jsreport.init()
  })

  it('should find and apply fs store', () => {
    should(jsreport.documentStore.provider.name).not.be.eql('fs')
  })
}).timeout(10000)

describe('extension sockets', () => {
  let jsreport
  let io

  beforeEach(() => {
    jsreport = JsReport()
    jsreport.use(require('jsreport-express')({ httpPort: 3000 }))
    jsreport.use(require('../')({ syncModifications: true }))
    return jsreport.init()
  })

  afterEach(() => {
    io.close()
    jsreport.close()
  })

  it('should emit sockets', (done) => {
    io = IO('http://localhost:3000')

    io.on('connect', () => jsreport.documentStore.provider.emit('external-modification'))

    io.on('external-modification', () => done())
  })
})
