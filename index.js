var main = require('./lib/main.js')
var config = require('./jsreport.config.js')

module.exports = function (options) {
  config = Object.assign({}, config)
  config.options = Object.assign({}, options)
  config.main = main
  config.directory = __dirname
  return config
}
