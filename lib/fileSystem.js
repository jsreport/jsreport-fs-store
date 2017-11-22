const Promise = require('bluebird')
const path = require('path')
const fs = require('fs')
Promise.promisifyAll(require('fs'))
const mkdirpAsync = Promise.promisify(require('mkdirp'))
const rimraf = Promise.promisify(require('rimraf'))
const lockFile = require('lockfile')
Promise.promisifyAll(lockFile)

module.exports = ({ dataDirectory }) => ({
  lastWriteTimeStamp: Date.now(),
  init: () => mkdirpAsync(dataDirectory),
  readdir: (p) => fs.readdirAsync(path.join(dataDirectory, p)),
  readFile: (p) => fs.readFileAsync(path.join(dataDirectory, p)),
  writeFile: (p, c) => fs.writeFileAsync(path.join(dataDirectory, p), c),
  appendFile: (p, c) => fs.appendFileAsync(path.join(dataDirectory, p), c),
  rename: (p, pp) => fs.renameAsync(path.join(dataDirectory, p), path.join(dataDirectory, pp)),
  exists: async (p) => {
    try {
      await fs.statAsync(path.join(dataDirectory, p))
      return true
    } catch (e) {
      return false
    }
  },
  stat: (p) => {
    return fs.statAsync(path.join(dataDirectory, p))
  },
  mkdir: (p) => mkdirpAsync(path.join(dataDirectory, p)),
  remove: (p) => rimraf(path.join(dataDirectory, p)),
  path: {
    join: path.join,
    sep: path.sep,
    basename: path.basename
  },
  async lock () {
    await mkdirpAsync(dataDirectory)
    await lockFile.lockAsync(path.join(dataDirectory, 'fs.lock'))
    this.lastWriteTimeStamp = Date.now()
  },
  releaseLock: () => lockFile.unlockAsync(path.join(dataDirectory, 'fs.lock'))
})
