/******/ (function(modules) { // webpackBootstrap
/******/ 	// The module cache
/******/ 	var installedModules = {};
/******/
/******/ 	// The require function
/******/ 	function __webpack_require__(moduleId) {
/******/
/******/ 		// Check if module is in cache
/******/ 		if(installedModules[moduleId])
/******/ 			return installedModules[moduleId].exports;
/******/
/******/ 		// Create a new module (and put it into the cache)
/******/ 		var module = installedModules[moduleId] = {
/******/ 			exports: {},
/******/ 			id: moduleId,
/******/ 			loaded: false
/******/ 		};
/******/
/******/ 		// Execute the module function
/******/ 		modules[moduleId].call(module.exports, module, module.exports, __webpack_require__);
/******/
/******/ 		// Flag the module as loaded
/******/ 		module.loaded = true;
/******/
/******/ 		// Return the exports of the module
/******/ 		return module.exports;
/******/ 	}
/******/
/******/
/******/ 	// expose the modules object (__webpack_modules__)
/******/ 	__webpack_require__.m = modules;
/******/
/******/ 	// expose the module cache
/******/ 	__webpack_require__.c = installedModules;
/******/
/******/ 	// __webpack_public_path__
/******/ 	__webpack_require__.p = "";
/******/
/******/ 	// Load entry module and return exports
/******/ 	return __webpack_require__(0);
/******/ })
/************************************************************************/
/******/ ([
/* 0 */
/***/ function(module, exports, __webpack_require__) {

	'use strict';
	
	var _jsreportStudio = __webpack_require__(1);
	
	var _jsreportStudio2 = _interopRequireDefault(_jsreportStudio);
	
	var _socket = __webpack_require__(2);
	
	var _socket2 = _interopRequireDefault(_socket);
	
	function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }
	
	function _asyncToGenerator(fn) { return function () { var gen = fn.apply(this, arguments); return new Promise(function (resolve, reject) { function step(key, arg) { try { var info = gen[key](arg); var value = info.value; } catch (error) { reject(error); return; } if (info.done) { resolve(value); } else { return Promise.resolve(value).then(function (value) { step("next", value); }, function (err) { step("throw", err); }); } } return step("next"); }); }; }
	
	_jsreportStudio2.default.initializeListeners.push(function () {
	  if (!_jsreportStudio2.default.extensions['fs-store-2'].options.syncModifications) {
	    console.log('Skipping active sync with server');
	    return;
	  }
	
	  var socket = (0, _socket2.default)({ path: _jsreportStudio2.default.resolveUrl('/socket.io') });
	
	  console.log('Listening to the server changes');
	  var syncing = false;
	  socket.on('external-modification', _asyncToGenerator( /*#__PURE__*/regeneratorRuntime.mark(function _callee() {
	    var lastActiveEntity;
	    return regeneratorRuntime.wrap(function _callee$(_context) {
	      while (1) {
	        switch (_context.prev = _context.next) {
	          case 0:
	            lastActiveEntity = _jsreportStudio2.default.getLastActiveTemplate();
	
	            if (!(!lastActiveEntity || syncing)) {
	              _context.next = 3;
	              break;
	            }
	
	            return _context.abrupt('return');
	
	          case 3:
	
	            console.log('Syncing last active entity', lastActiveEntity);
	            syncing = true;
	
	            _context.prev = 5;
	
	            _jsreportStudio2.default.unloadEntity(lastActiveEntity._id);
	            _context.next = 9;
	            return _jsreportStudio2.default.loadEntity(lastActiveEntity._id);
	
	          case 9:
	            _jsreportStudio2.default.openTab({ _id: lastActiveEntity._id });
	            _jsreportStudio2.default.preview();
	
	          case 11:
	            _context.prev = 11;
	
	            syncing = false;
	            return _context.finish(11);
	
	          case 14:
	          case 'end':
	            return _context.stop();
	        }
	      }
	    }, _callee, undefined, [[5,, 11, 14]]);
	  })));
	});

/***/ },
/* 1 */
/***/ function(module, exports) {

	module.exports = Studio;

/***/ },
/* 2 */
/***/ function(module, exports) {

	module.exports = Studio.libraries['socket.io-client'];

/***/ }
/******/ ]);