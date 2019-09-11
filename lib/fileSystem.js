const Promise = require('bluebird')
const path = require('path')
const fs = require('fs')
Promise.promisifyAll(require('fs'))
const mkdirpAsync = Promise.promisify(require('mkdirp'))
const rimraf = Promise.promisify(require('rimraf'))
const lockFile = require('lockfile')
Promise.promisifyAll(lockFile)

module.exports = ({ dataDirectory, lock }) => ({
  lockIntervals: [],
  lockOptions: Object.assign({ stale: 5000, retries: 100, retryWait: 100, maxSizeIntervalsForSync: 500 }, lock),
  init: () => mkdirpAsync(dataDirectory),
  readdir: p => fs.readdirAsync(path.join(dataDirectory, p)),
  readFile: p => fs.readFileAsync(path.join(dataDirectory, p)),
  writeFile (p, c) {
    return fs.writeFileAsync(path.join(dataDirectory, p), c)
  },
  appendFile (p, c) {
    return fs.appendFileAsync(path.join(dataDirectory, p), c)
  },
  rename (p, pp) {
    return fs.renameAsync(path.join(dataDirectory, p), path.join(dataDirectory, pp))
  },
  exists: async p => {
    try {
      await fs.statAsync(path.join(dataDirectory, p))
      return true
    } catch (e) {
      return false
    }
  },
  stat: p => {
    return fs.statAsync(path.join(dataDirectory, p))
  },
  mkdir (p) {
    return mkdirpAsync(path.join(dataDirectory, p))
  },
  remove (p) {
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
    this.currentLockInterval = {
      start: new Date()
    }
    this.lockIntervals.push(this.currentLockInterval)

    if (this.lockIntervals.length > this.lockOptions.maxSizeIntervalsForSync) {
      this.lockIntervals.shift()
    }
  },
  async releaseLock () {
    this.currentLockInterval.end = new Date()
    await lockFile.unlockAsync(path.join(dataDirectory, 'fs.lock'))
  }
})
