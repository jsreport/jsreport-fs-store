const Promise = require('bluebird')
const path = require('path')
const fs = require('fs')
Promise.promisifyAll(require('fs'))
const mkdirpAsync = Promise.promisify(require('mkdirp'))
const rimraf = Promise.promisify(require('rimraf'))
const lockFile = require('lockfile')
Promise.promisifyAll(lockFile)

module.exports = ({ dataDirectory, lock }) => ({
  memoryState: {},
  lockOptions: Object.assign({ stale: 5000, retries: 100, retryWait: 100, maxSizeIntervalsForSync: 500 }, lock),
  init: () => mkdirpAsync(dataDirectory),
  readdir: p => fs.readdirAsync(path.join(dataDirectory, p)),
  async readFile (p) {
    const res = await fs.readFileAsync(path.join(dataDirectory, p))
    if (!p.includes('~')) {
      this.memoryState[path.join(dataDirectory, p)] = { content: res.toString(), isDirectory: false }
    }
    return res
  },
  writeFile (p, c) {
    if (!p.includes('~')) {
      this.memoryState[path.join(dataDirectory, p)] = { content: c, isDirectory: false }
    }

    return fs.writeFileAsync(path.join(dataDirectory, p), c)
  },
  appendFile (p, c) {
    const fpath = path.join(dataDirectory, p)
    if (!p.includes('~')) {
      this.memoryState[fpath] = this.memoryState[fpath] || { content: '', isDirectory: false }
      this.memoryState[fpath].content += c
    }

    return fs.appendFileAsync(fpath, c)
  },
  async rename (p, pp) {
    if (p.includes('~') && !pp.includes('~')) {
      const readDirMemoryState = async (sp, dp) => {
        this.memoryState[dp] = { isDirectory: true }
        const contents = await fs.readdirAsync(sp)
        for (const c of contents) {
          const stat = await fs.statAsync(path.join(sp, c))
          if (stat.isDirectory()) {
            await readDirMemoryState(path.join(sp, c), path.join(dp, c))
          } else {
            const fcontent = await fs.readFileAsync(path.join(sp, c))
            this.memoryState[path.join(dp, c)] = { content: fcontent.toString(), isDirectory: false }
          }
        }
      }
      const rstat = await fs.statAsync(path.join(dataDirectory, p))
      if (rstat.isDirectory()) {
        await readDirMemoryState(path.join(dataDirectory, p), path.join(dataDirectory, pp))
      } else {
        const fcontent = await fs.readFileAsync(path.join(dataDirectory, p))
        this.memoryState[path.join(dataDirectory, pp)] = { content: fcontent.toString(), isDirectory: false }
      }
    }

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
  async stat (p) {
    const stat = await fs.statAsync(path.join(dataDirectory, p))
    if (!p.includes('~') && stat.isDirectory()) {
      this.memoryState[path.join(dataDirectory, p)] = { isDirectory: true }
    }
    return stat
  },
  async mkdir (p) {
    if (!p.includes('~')) {
      this.memoryState[path.join(dataDirectory, p)] = { isDirectory: true }
    }

    await mkdirpAsync(path.join(dataDirectory, p))
  },
  async remove (p) {
    for (const c in this.memoryState) {
      if (c.startsWith(path.join(dataDirectory, p, '/')) || c === path.join(dataDirectory, p)) {
        delete this.memoryState[c]
      }
    }

    await rimraf(path.join(dataDirectory, p))
  },
  path: {
    join: path.join,
    sep: path.sep,
    basename: path.basename
  },
  async lock () {
    await mkdirpAsync(dataDirectory)
    return lockFile.lockAsync(path.join(dataDirectory, 'fs.lock'), Object.assign({}, this.lockOptions))
  },
  releaseLock () {
    return lockFile.unlockAsync(path.join(dataDirectory, 'fs.lock'))
  }
})
