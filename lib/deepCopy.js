var model = require('nedb/lib/model.js')
var util = require('util')

// monkey patching nedb model.deepCopy to optimize buffer clonning
// this gives us ~80ms for getting image from db

var deepCopy = model.deepCopy = function (obj, strictKeys) {
  var res;

  // optimization
  if (Buffer.isBuffer(obj)) {
    return obj.slice()
  }

  if ( typeof obj === 'boolean' ||
    typeof obj === 'number' ||
    typeof obj === 'string' ||
    obj === null ||
    (util.isDate(obj)) ) {
    return obj;
  }

  if (util.isArray(obj)) {
    res = [];
    obj.forEach(function (o) { res.push(deepCopy(o, strictKeys)); });
    return res;
  }

  if (typeof obj === 'object') {
    res = {};
    Object.keys(obj).forEach(function (k) {
      if (!strictKeys || (k[0] !== '$' && k.indexOf('.') === -1)) {
        res[k] = deepCopy(obj[k], strictKeys);
      }
    });
    return res;
  }

  return undefined;   // For now everything else is undefined. We should probably throw an error instead
}