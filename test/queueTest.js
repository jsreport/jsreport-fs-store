const Queue = require('../lib/queue')
const Promise = require('bluebird')
require('should-sinon')
require('should')

describe('queue', () => {
  let queue

  beforeEach(() => (queue = Queue()))

  it('should process one item', async () => {
    let processed = false
    await queue(() => (processed = true))
    processed.should.be.true()
  })

  it('should process multiple items step by step', async () => {
    let r1
    let r2
    let r2Running = false

    const p1 = queue(() => (new Promise((resolve) => {
      r1 = resolve
    })))

    const p2 = queue(() => (new Promise((resolve) => {
      r2Running = true
      r2 = resolve
    })))

    r2Running.should.be.false()
    r1()
    await p1
    r2()
    await p2
    r2Running.should.be.true()
  })
})
