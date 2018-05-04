const Promise = require('bluebird')
const { deepGet, deepSet, deepDelete, serialize, parse, retry } = require('./customUtils')

function getEntitySetNameFromPath (fs, p) {
  const fragments = p.split(fs.path.sep)
  return fragments[fragments.length - 2]
}

async function parseFiles (fs, parentDirectory, documentsModel, files) {
  const configFile = files.find(f => f === 'config.json')

  if (!configFile) {
    return []
  }

  const es = documentsModel.entitySets[getEntitySetNameFromPath(fs, parentDirectory)]

  // the extension is not enabled for this es directory
  if (!es) {
    return []
  }

  const entityType = es.entityType
  let document = parse((await fs.readFile(fs.path.join(parentDirectory, configFile))).toString())
  const pathFragments = parentDirectory.split(fs.path.sep)
  document.$entitySet = pathFragments[pathFragments.length - 2]
  document[entityType.publicKey] = fs.path.basename(parentDirectory)

  for (const prop of entityType.documentProperties) {
    const matchingDocumentFile = files.find((f) => {
      const fileWithoutExtension = f.substring(0, f.lastIndexOf('.'))
      const pathFragments = prop.path.split('.')
      return fileWithoutExtension === pathFragments[pathFragments.length - 1]
    })

    if (!matchingDocumentFile) {
      continue
    }

    const content = await fs.readFile(fs.path.join(parentDirectory, matchingDocumentFile))

    deepSet(document, prop.path, prop.type.type === 'Edm.Binary' ? content : content.toString('utf8'))
  }

  return [document]
}

async function load (fs, directory, model, documents) {
  const dirEntries = await fs.readdir(directory)
  const contentStats = await Promise.all(dirEntries.map(async (e) => ({ name: e, stat: await fs.stat(fs.path.join(directory, e)) })))
  const loadedDocuments = await parseFiles(fs, directory, model, contentStats.filter((e) => !e.stat.isDirectory()).map(e => e.name))
  documents.push(...loadedDocuments)

  let dirNames = contentStats.filter((e) => e.stat.isDirectory()).map((e) => e.name)

  for (let dir of dirNames.filter((n) => n.startsWith('~'))) {
    // inconsistent tmp entity, remove...
    if (dir.startsWith('~~')) {
      dirNames = dirNames.filter((n) => n !== dir)
      await fs.remove(fs.path.join(directory, dir))
      continue
    }

    // consistent tmp entity, remove the original one and rename
    const originalName = dir.substring(1).split('~')[0]
    const newName = dir.substring(1).split('~')[1]

    if (!originalName || !newName) {
      throw new Error(`Wrong name pattern for ${fs.path.join(directory, dir)}.`)
    }

    await fs.remove(fs.path.join(directory, originalName))
    await fs.rename(fs.path.join(directory, dir), fs.path.join(directory, newName))
    dirNames = dirNames.filter((n) => n !== dir)
    // when renaming (~c~c) to (c) and (c) exist, we don't add
    if (!dirNames.find((n) => n === newName)) {
      dirNames.push(newName)
    }
  }

  await Promise.all(dirNames.map((n) => load(fs, fs.path.join(directory, n), model, documents)))
  return documents
}

async function persist (fs, resolveFileExtension, model, doc, originalDoc) {
  if (!model.entitySets[doc.$entitySet].splitIntoDirectories) {
    return fs.appendFile(doc.$entitySet, serialize(doc, false) + '\n')
  }

  const entityType = model.entitySets[doc.$entitySet].entityType
  if (doc[entityType.publicKey].indexOf('/') !== -1) {
    throw new Error('Document cannot contain / in the ' + entityType.publicKey)
  }

  const originalDocPrefix = originalDoc ? (originalDoc[entityType.publicKey] + '~') : ''
  const docInconsistentPath = fs.path.join(doc.$entitySet, `~~${originalDocPrefix}${doc[entityType.publicKey]}`)
  const docConsistentPath = fs.path.join(doc.$entitySet, `~${originalDocPrefix}${doc[entityType.publicKey]}`)
  const docFinalPath = fs.path.join(doc.$entitySet, doc[entityType.publicKey])

  if (!originalDoc && (await fs.exists(docFinalPath))) {
    throw new Error('Duplicated entry for key ' + doc[entityType.publicKey])
  }

  await fs.mkdir(docInconsistentPath)

  const docClone = Object.assign({}, doc)

  await Promise.map(entityType.documentProperties, async (prop) => {
    const fileExtension = resolveFileExtension(docClone, docClone.$entitySet, entityType, prop.type)
    let value = deepGet(docClone, prop.path)
    value = value || ''

    if (prop.type.type === 'Edm.Binary' && !Buffer.isBuffer(value)) {
      value = Buffer.from(value, 'base64')
    }

    const pathFragments = prop.path.split('.')
    await fs.writeFile(fs.path.join(docInconsistentPath, pathFragments[pathFragments.length - 1] + '.' + fileExtension), value)

    deepDelete(docClone, prop.path)
  })
  await fs.writeFile(fs.path.join(docInconsistentPath, 'config.json'), serialize(docClone))

  await fs.rename(docInconsistentPath, docConsistentPath)
  if (originalDoc) {
    await fs.remove(fs.path.join(doc.$entitySet, originalDoc[entityType.publicKey]))
  }

  // the final rename sometimes throws EPERM error, because the folder is still somehow
  // blocked because of previous reload, the retry should help in the case
  await retry(() => fs.rename(docConsistentPath, docFinalPath), 5)
}

async function remove (fs, model, doc) {
  if (!model.entitySets[doc.$entitySet].splitIntoDirectories) {
    const removal = { $$deleted: true, _id: doc._id }
    return fs.appendFile(doc.$entitySet, serialize(removal, false) + '\n')
  }

  const entityType = model.entitySets[doc.$entitySet].entityType
  const originalDocPath = fs.path.join(doc.$entitySet, doc[entityType.publicKey])

  await fs.remove(originalDocPath)
}

async function loadFlatDocument (fs, file, documents) {
  const contents = (await fs.readFile(file)).toString()
  const parsedDocs = contents.split('\n').filter(c => c).map(parse)
  const resultDocs = {}
  for (const doc of parsedDocs) {
    if (doc.$$deleted) {
      delete resultDocs[doc._id]
      continue
    }

    doc.$entitySet = file
    resultDocs[doc._id] = doc
  }

  await fs.writeFile(file, Object.keys(resultDocs).map((d) => serialize(resultDocs[d], false)).join('\n') + '\n')
  Object.keys(resultDocs).forEach((k) => documents.push(resultDocs[k]))
}

async function loadFlatDocuments (fs, documentsModel, documents) {
  const dirEntries = await fs.readdir('')
  const contentStats = await Promise.all(dirEntries.map(async (e) => ({ name: e, stat: await fs.stat(e) })))
  const flatFilesToLoad = contentStats.filter(e => !e.stat.isDirectory() && documentsModel.entitySets[e.name]).map(e => e.name)

  for (const file of flatFilesToLoad) {
    await loadFlatDocument(fs, file, documents)
  }
}

async function lock (fs, op) {
  const l = await fs.lock()
  try {
    return await op()
  } finally {
    await fs.releaseLock(l)
  }
}

module.exports = ({ fs, documentsModel, resolveFileExtension }) => ({
  update: (doc, originalDoc) => lock(fs, () => persist(fs, resolveFileExtension, documentsModel, doc, originalDoc)),
  insert: (doc) => lock(fs, () => persist(fs, resolveFileExtension, documentsModel, doc)),
  remove: (doc) => lock(fs, () => remove(fs, documentsModel, doc)),
  reload: (doc) => lock(fs, async () => {
    const documents = []
    const entityType = documentsModel.entitySets[doc.$entitySet].entityType
    await load(fs, fs.path.join(doc.$entitySet, doc[entityType.publicKey]), documentsModel, documents)

    return documents.length !== 1 ? null : documents[0]
  }),
  load: () => lock(fs, async () => {
    const documents = []
    await load(fs, '', documentsModel, documents)
    await loadFlatDocuments(fs, documentsModel, documents)
    return documents
  }),
  compact: () => lock(fs, () => loadFlatDocuments(fs, documentsModel, []))
})
