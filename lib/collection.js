const ListenerCollection = require('listener-collection')

module.exports = (entitySet, provider) => ({
  beforeFindListeners: new ListenerCollection(),
  beforeUpdateListeners: new ListenerCollection(),
  beforeInsertListeners: new ListenerCollection(),
  beforeRemoveListeners: new ListenerCollection(),
  entitySet,

  load: (...args) => {
    provider.load(entitySet, ...args)
  },

  find (...args) {
    const listenerPromise = this.beforeFindListeners.fire(...args)

    // the jsreport backcompatible API for find returns promise with the result array
    // the new API returns a cursor like mongo uses
    // to make it working for both way of calling, we return
    // an object which is a promise and in the same time a cursor
    const cursorCalls = []
    const functions = ['skip', 'limit', 'sort', 'toArray', 'count']
    const fakeCursor = {}
    functions.forEach((f) => {
      fakeCursor[f] = (...args) => {
        cursorCalls.push({f: f, args: args})
        return fakeCursor
      }
    })

    const replay = (cursor) => {
      cursorCalls.filter((c) => c.f !== 'toArray' && c.f !== 'count').forEach((c) => cursor[c.f].apply(cursor, c.args))

      if (cursorCalls.find((c) => c.f === 'count')) {
        return cursor.count()
      }

      return cursor.toArray()
    }

    return Object.assign(fakeCursor, {
      then: (onFulfilled, onRejected) => {
        // the node A compatible promise expects then to be called with two functions
        // the bluebird expects to return a promise
        let promise = listenerPromise.then(() => replay(provider.find(entitySet, ...args)))

        // the node A compatible promise expects then to be called with two functions
        // the bluebird expects to return a promise
        if (typeof onFulfilled === 'function') {
          promise = promise.then(onFulfilled)
        }

        if (typeof onRejected === 'function') {
          promise = promise.catch(onRejected)
        }

        return promise
      }
    })
  },

  count (...args) {
    return this.find(...args).count()
  },

  async insert (...args) {
    await this.beforeInsertListeners.fire(...args)
    return provider.insert(entitySet, ...args)
  },

  async update (...args) {
    await this.beforeUpdateListeners.fire(...args)
    return provider.update(entitySet, ...args)
  },

  async remove (...args) {
    await this.beforeRemoveListeners.fire(...args)
    return provider.remove(entitySet, ...args)
  }
})
