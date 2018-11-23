const extend = require('node.extend.without.arrays')

function collectDocumentProperties (model, entityType) {
  const documentProperties = []

  function deepWalk (type, path) {
    var p = path ? path + '.' : ''
    Object.keys(type).forEach(function (k) {
      if (type[k].document) {
        return documentProperties.push({ path: p + k, type: type[k] })
      }

      if (type[k].type.indexOf('Edm') !== 0 && type[k].type.indexOf('Collection(') === -1) {
        var complexTypeName = type[k].type.replace(model.namespace + '.', '')
        var complexType = model.complexTypes[complexTypeName]
        deepWalk(complexType, p + k)
      }
    })
  }

  deepWalk(entityType)
  return documentProperties
}

module.exports = (model) => {
  const documentModel = extend(true, {}, model)

  Object.keys(documentModel.entitySets).forEach(e => {
    const es = documentModel.entitySets[e]
    es.entityType = Object.assign({}, model.entityTypes[es.entityType.replace(documentModel.namespace + '.', '')])
    es.entityType.documentProperties = collectDocumentProperties(model, es.entityType)
    es.entityType.publicKey = Object.keys(es.entityType).find(t => es.entityType[t].publicKey)
  })

  return documentModel
}
