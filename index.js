var main = require('./lib/main.js');
var config = require('jsreport.config.js')();

module.exports = function (options) {
  config.options = options;
  config.main = main;
  return config;
};
