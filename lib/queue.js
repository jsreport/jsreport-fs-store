const Promise = require('bluebird')

module.exports = () => {
  const items = []
  let busy = false

  function execute () {
    if (items.length < 1 || busy) {
      return
    }

    busy = true
    const item = items.shift()

    Promise.resolve(item.fn()).then((res) => {
      item.resolve(res)
      busy = false
      execute()
      return null
    }).catch((err) => {
      item.reject(err)
      busy = false
      execute()
      return null
    })
  }

  return (fn) => {
    let _resolve, _reject
    const result = new Promise((resolve, reject) => {
      _resolve = resolve
      _reject = reject
    })
    items.push({
      fn,
      resolve: _resolve,
      reject: _reject
    })

    execute()
    return result
  }
}
