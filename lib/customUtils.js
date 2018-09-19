const crypto = require('crypto')
const Promise = require('bluebird')

/**
* Return a random alphanumerical string of length len
* There is a very small probability (less than 1/1,000,000) for the length to be less than len
* (il the base64 conversion yields too many pluses and slashes) but
* that's not an issue here
* The probability of a collision is extremely small (need 3*10^12 documents to have one chance in a million of a collision)
* See http://en.wikipedia.org/wiki/Birthday_problem
*/
function uid (len) {
  return crypto.randomBytes(Math.ceil(Math.max(8, len * 2)))
    .toString('base64')
    .replace(/[+/]/g, '')
    .slice(0, len)
}

function deepGet (doc, path) {
  const paths = path.split('.')
  for (let i = 0; i < paths.length && doc; i++) {
    doc = doc[paths[i]]
  }

  return doc
}

function deepDelete (doc, path) {
  var paths = path.split('.')
  for (var i = 0; i < paths.length && doc; i++) {
    if (i === paths.length - 1) {
      delete doc[paths[i]]
    } else {
      doc = doc[paths[i]]
    }
  }
}

function deepSet (doc, path, val) {
  const paths = path.split('.')
  for (let i = 0; i < paths.length && doc; i++) {
    if (i === paths.length - 1) {
      doc[paths[i]] = val
    } else {
      doc = doc[paths[i]]
    }
  }
}

function serialize (obj, prettify = true) {
  var res

  var originalDateToJSON = Date.prototype.toJSON
  // Keep track of the fact that this is a Date object
  Date.prototype.toJSON = function () { // eslint-disable-line
    return { $$date: this.getTime() }
  }

  res = JSON.stringify(obj, function (k, v) {
    if (typeof v === 'undefined') {
      return null
    }
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' || v === null) {
      return v
    }

    return v
  }, prettify ? 4 : null)

  // Return Date to its original state
  Date.prototype.toJSON = originalDateToJSON // eslint-disable-line

  return res
}

function parse (rawData) {
  return JSON.parse(rawData, function (k, v) {
    if (k === '$$date') {
      return new Date(v)
    }
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' || v === null) {
      return v
    }
    if (v && v.$$date) {
      return v.$$date
    }

    return v
  })
}

async function retry (fn, maxCount = 10) {
  let error
  for (var i = 0; i < maxCount; i++) {
    try {
      const res = await fn()
      return res
    } catch (e) {
      error = e
      await Promise.delay(i * 10)
    }
  }

  throw error
}

module.exports.uid = uid
module.exports.deepGet = deepGet
module.exports.deepSet = deepSet
module.exports.deepDelete = deepDelete
module.exports.serialize = serialize
module.exports.parse = parse
module.exports.retry = retry
