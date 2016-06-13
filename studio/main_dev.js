import Studio from 'jsreport-studio'
import io from 'socket.io-client'

Studio.initializeListeners.push(() => {
  if (!Studio.extensions['fs-store'].enabled) {
    return
  }

  const socket = io()
  socket.on('external-modification', async () => {
    const lastActiveEntity = Studio.getLastActiveTemplate()
    if (!lastActiveEntity) {
      return
    }

    Studio.unloadEntity(lastActiveEntity._id)
    await Studio.loadEntity(lastActiveEntity._id)
    Studio.openTab({ _id: lastActiveEntity._id })
    Studio.preview()
  })
})

