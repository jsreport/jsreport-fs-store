const Promise = require('bluebird')
const path = require('path')
const fs = require('fs')
Promise.promisifyAll(require('fs'))
const mkdirpAsync = Promise.promisify(require('mkdirp'))
const rimraf = Promise.promisify(require('rimraf'))
const lockFile = require('lockfile')
Promise.promisifyAll(lockFile)

module.exports = ({ dataDirectory, lock }) => ({
  lockOptions: Object.assign({ stale: 5000, retries: 100, retryWait: 100 }, lock),
  lastWriteTimeStamp: Date.now(),
  init: () => mkdirpAsync(dataDirectory),
  readdir: (p) => fs.readdirAsync(path.join(dataDirectory, p)),
  readFile: (p) => fs.readFileAsync(path.join(dataDirectory, p)),
  writeFile (p, c) {
    this.lastWriteTimeStamp = Date.now()
    return fs.writeFileAsync(path.join(dataDirectory, p), c)
  },
  appendFile (p, c) {
    this.lastWriteTimeStamp = Date.now()
    return fs.appendFileAsync(path.join(dataDirectory, p), c)
  },
  rename (p, pp) {
    this.lastWriteTimeStamp = Date.now()
    return fs.renameAsync(path.join(dataDirectory, p), path.join(dataDirectory, pp))
  },
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
  mkdir (p) {
    this.lastWriteTimeStamp = Date.now()
    return mkdirpAsync(path.join(dataDirectory, p))
  },
  remove (p) {
    this.lastWriteTimeStamp = Date.now()
    return rimraf(path.join(dataDirectory, p))
  },
  path: {
    join: path.join,
    sep: path.sep,
    basename: path.basename
  },
  async lock () {
    await mkdirpAsync(dataDirectory)
    await lockFile.lockAsync(path.join(dataDirectory, 'fs.lock'), Object.assign({}, this.lockOptions))
    this.lastWriteTimeStamp = Date.now()
  },
  releaseLock: () => lockFile.unlockAsync(path.join(dataDirectory, 'fs.lock'))
})
