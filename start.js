const jsreport = require('jsreport-core')({
  store: {
    provider: 'fs'
  },
  logger: {
    'console': { 'transport': 'console', 'level': 'debug' }
  },
  httpPort: 5488,
  extensions: {
    'fs-store': {
      dataDirectory: require('path').join(__dirname, 'data')
    }
  }
})

jsreport.use(require('jsreport-authentication')())
jsreport.use(require('jsreport-data')())
jsreport.use(require('jsreport-templates')())
jsreport.use(require('jsreport-fs-store')())
jsreport.use(require('jsreport-express')())
jsreport.use(require('jsreport-phantom-pdf')())
jsreport.use(require('jsreport-studio')())
jsreport.use(require('jsreport-handlebars')())
jsreport.use(require('jsreport-debug')())
jsreport.use(require('jsreport-scripts')())
jsreport.use(require('jsreport-authorization')())
jsreport.use(require('jsreport-jsrender')())
jsreport.use(require('jsreport-child-templates')())
jsreport.use(require('jsreport-browser-client')())
jsreport.use(require('jsreport-public-templates')())
jsreport.use(require('jsreport-images')())
jsreport.use(require('jsreport-scheduling')())
jsreport.use(require('jsreport-reports')())
jsreport.use(require('jsreport-resources')())
jsreport.use(require('jsreport-text')())
jsreport.use(require('jsreport-xlsx')())
jsreport.use(require('jsreport-assets')())
jsreport.use(require('jsreport-import-export')())
jsreport.use(require('jsreport-tags')())
jsreport.use(require('./')())

jsreport.init().catch(console.error.bind(console))
