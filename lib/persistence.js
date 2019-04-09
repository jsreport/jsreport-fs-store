const Promise = require('bluebird')
const { deepGet, deepSet, deepDelete, serialize, parse, retry, uid } = require('./customUtils')
const extend = require('node.extend.without.arrays')

function getDirectoryPath (fs, model, doc, documents) {
  if (!doc.folder) {
    return ''
  }

  const entityType = model.entitySets[doc.$entitySet].entityType

  let folders = []

  while (doc.folder) {
    const folderEntity = documents.folders.find((f) => f.shortid === doc.folder.shortid)

    if (!folderEntity) {
      throw new Error(`Can not find parent folder for entity "${doc[entityType.publicKey]}" (entitySet: ${doc.$entitySet})`)
    }

    folders.push(folderEntity.name)
    doc = folderEntity
  }

  return folders.reverse().join(fs.path.sep)
}

function getEntitySetNameFromPath (fs, p) {
  const fragments = p.split(fs.path.sep)
  return fragments[fragments.length - 2]
}

async function copy (fs, psource, ptarget) {
  await fs.mkdir(ptarget)
  const dirEntries = await fs.readdir(psource)

  return Promise.all(dirEntries.map(async f => {
    const stat = await fs.stat(fs.path.join(psource, f))
    if (stat.isDirectory()) {
      return copy(fs, fs.path.join(psource, f), fs.path.join(ptarget, f))
    }

    const content = await fs.readFile(fs.path.join(psource, f))
    return fs.writeFile(fs.path.join(ptarget, f), content)
  }))
}

async function parseFiles (fs, parentDirectory, documentsModel, files) {
  let configFile = files.find(f => f === 'config.json')

  if (!configFile && !parentDirectory) {
    return []
  }

  if (!configFile) {
    const folder = {
      _id: uid(16),
      shortid: uid(6),
      $entitySet: 'folders',
      name: fs.path.basename(parentDirectory)
    }
    await fs.writeFile(fs.path.join(parentDirectory, 'config.json'), serialize(folder))

    return [folder]
  }

  const pathToFile = fs.path.join(parentDirectory, configFile)
  const rawContent = (await fs.readFile(pathToFile)).toString()
  let document

  try {
    document = parse(rawContent)
  } catch (e) {
    const newE = new Error(`Error when trying to parse file at "${pathToFile}", check that file constains valid JSON. ${e.message}`)
    throw newE
  }

  if (!document.$entitySet) {
    document.$entitySet = getEntitySetNameFromPath(fs, parentDirectory)
  }

  const es = documentsModel.entitySets[document.$entitySet]
  if (!es) {
    return []
  }
  const entityType = es.entityType

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

async function load (fs, directory, model, documents, parentDirectoryEntity) {
  const dirEntries = await fs.readdir(directory)
  const contentStats = await Promise.all(dirEntries.map(async (e) => ({ name: e, stat: await fs.stat(fs.path.join(directory, e)) })))

  const loadedDocuments = await parseFiles(fs, directory, model, contentStats.filter((e) => !e.stat.isDirectory()).map(e => e.name))

  for (const d of loadedDocuments) {
    if (parentDirectoryEntity && !d.folder) {
      d.folder = { shortid: parentDirectoryEntity.shortid }
    }
    if (d.$entitySet === 'folders') {
      parentDirectoryEntity = d
    }
  }

  documents.push(...loadedDocuments)

  let dirNames = contentStats.filter((e) => e.stat.isDirectory() && e.name !== 'storage').map((e) => e.name)

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

  await Promise.all(dirNames.map((n) => load(fs, fs.path.join(directory, n), model, documents, parentDirectoryEntity)))
  return documents
}

async function persist (fs, resolveFileExtension, model, doc, originalDoc, documents) {
  if (!model.entitySets[doc.$entitySet].splitIntoDirectories) {
    return fs.appendFile(doc.$entitySet, serialize(doc, false) + '\n')
  }

  const entityType = model.entitySets[doc.$entitySet].entityType
  if (doc[entityType.publicKey].indexOf('/') !== -1) {
    throw new Error('Document cannot contain / in the ' + entityType.publicKey)
  }

  const originalDocPrefix = originalDoc ? (originalDoc[entityType.publicKey] + '~') : ''
  const docInconsistentPath = fs.path.join(getDirectoryPath(fs, model, doc, documents), `~~${originalDocPrefix}${doc[entityType.publicKey]}`)
  const docConsistentPath = fs.path.join(getDirectoryPath(fs, model, doc, documents), `~${originalDocPrefix}${doc[entityType.publicKey]}`)
  const docFinalPath = fs.path.join(getDirectoryPath(fs, model, doc, documents), doc[entityType.publicKey])

  if (!originalDoc && (await fs.exists(docFinalPath))) {
    throw new Error('Duplicated entry for key ' + doc[entityType.publicKey])
  }

  if (await fs.exists(docInconsistentPath)) {
    await fs.remove(docInconsistentPath)
  }

  await fs.mkdir(docInconsistentPath)

  const docClone = extend(true, {}, doc)

  if (originalDoc && docClone.$entitySet === 'folders') {
    await copy(fs, fs.path.join(getDirectoryPath(fs, model, originalDoc, documents), originalDoc[entityType.publicKey]), docInconsistentPath)
  }

  await Promise.map(entityType.documentProperties, async (prop) => {
    const fileExtension = resolveFileExtension(docClone, docClone.$entitySet, entityType, prop.type)
    let value = deepGet(docClone, prop.path)

    if (value == null) {
      deepDelete(docClone, prop.path)
      return
    }

    value = value || ''

    if (prop.type.type === 'Edm.Binary' && !Buffer.isBuffer(value)) {
      value = Buffer.from(value, 'base64')
    }

    const pathFragments = prop.path.split('.')
    await fs.writeFile(fs.path.join(docInconsistentPath, pathFragments[pathFragments.length - 1] + '.' + fileExtension), value)

    deepDelete(docClone, prop.path)
  })
  await fs.writeFile(fs.path.join(docInconsistentPath, 'config.json'), serialize(docClone))

  if (await fs.exists(docConsistentPath)) {
    await fs.remove(docConsistentPath)
  }
  await retry(() => fs.rename(docInconsistentPath, docConsistentPath), 5)
  if (originalDoc) {
    await fs.remove(fs.path.join(getDirectoryPath(fs, model, originalDoc, documents), originalDoc[entityType.publicKey]))
  }

  // the final rename sometimes throws EPERM error, because the folder is still somehow
  // blocked because of previous reload, the retry should help in the case
  await retry(() => fs.rename(docConsistentPath, docFinalPath), 5)
}

async function remove (fs, model, doc, documents) {
  if (!model.entitySets[doc.$entitySet].splitIntoDirectories) {
    const removal = { $$deleted: true, _id: doc._id }
    return fs.appendFile(doc.$entitySet, serialize(removal, false) + '\n')
  }

  const entityType = model.entitySets[doc.$entitySet].entityType
  const originalDocPath = fs.path.join(getDirectoryPath(fs, model, doc, documents), doc[entityType.publicKey])

  await fs.remove(originalDocPath)
}

async function loadFlatDocument (fs, file, documents, corruptAlertThreshold) {
  const contents = (await fs.readFile(file)).toString().split('\n').filter(c => c)
  const resultDocs = {}
  let corruptItems = -1 // Last line of every data file is usually blank so not really corrupt

  for (const docContent of contents) {
    try {
      const doc = parse(docContent)

      if (doc.$$deleted) {
        delete resultDocs[doc._id]
        continue
      }

      doc.$entitySet = file
      resultDocs[doc._id] = doc
    } catch (e) {
      corruptItems += 1
    }
  }

  if (contents.length > 0 && (corruptItems / contents.length) > corruptAlertThreshold) {
    throw Error(`Data file "${file}" is corrupted. To recover you need to open it in an editor and fix the json inside.`)
  }

  Object.keys(resultDocs).forEach((k) => documents.push(resultDocs[k]))
}

async function persistFlatCacheToFiles (fs, model, documents) {
  for (const es of Object.keys(documents)) {
    if (model.entitySets[es].splitIntoDirectories) {
      continue
    }

    if (!(await fs.exists(es)) && documents[es].length === 0) {
      continue
    }

    await fs.writeFile('~' + es, documents[es].map((d) => serialize(d, false)).join('\n') + '\n')

    // the final rename sometimes throws EPERM error, because the folder is still somehow
    // blocked because of previous reload, the retry should help in the case
    await retry(() => fs.rename('~' + es, es), 5)
  }
}

async function loadFlatDocuments (fs, documentsModel, documents, corruptAlertThreshold) {
  const dirEntries = await fs.readdir('')
  const contentStats = await Promise.all(dirEntries.map(async (e) => ({ name: e, stat: await fs.stat(e) })))
  const flatFilesToLoad = contentStats.filter(e => !e.stat.isDirectory() && documentsModel.entitySets[e.name]).map(e => e.name)

  for (const file of flatFilesToLoad.filter(f => !f.startsWith('~'))) {
    await loadFlatDocument(fs, file, documents, corruptAlertThreshold)
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

module.exports = ({ fs, documentsModel, corruptAlertThreshold, resolveFileExtension }) => ({
  update: (doc, originalDoc, documents) => lock(fs, () => persist(fs, resolveFileExtension, documentsModel, doc, originalDoc, documents)),
  insert: (doc, documents) => lock(fs, () => persist(fs, resolveFileExtension, documentsModel, doc, null, documents)),
  remove: (doc, documents) => lock(fs, () => remove(fs, documentsModel, doc, documents)),
  reload: (doc) => lock(fs, async () => {
    const documents = []
    const entityType = documentsModel.entitySets[doc.$entitySet].entityType
    await load(fs, fs.path.join(doc.$entitySet, doc[entityType.publicKey]), documentsModel, documents)

    return documents.length !== 1 ? null : documents[0]
  }),
  load: () => lock(fs, async () => {
    const documents = []
    await load(fs, '', documentsModel, documents)
    await loadFlatDocuments(fs, documentsModel, documents, corruptAlertThreshold)
    return documents
  }),
  compact: (documents) => lock(fs, () => persistFlatCacheToFiles(fs, documentsModel, documents))
})
