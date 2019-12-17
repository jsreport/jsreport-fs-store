# jsreport-fs-store
[![NPM Version](http://img.shields.io/npm/v/jsreport-fs-store.svg?style=flat-square)](https://npmjs.com/package/jsreport-fs-store)
[![Build Status](https://travis-ci.org/jsreport/jsreport-fs-store.png?branch=master)](https://travis-ci.org/jsreport/jsreport-fs-store)

**[jsreport](https://github.com/jsreport/jsreport) template store extension. Supports editing templates in the external editors and browsers live reload and preview!**

See the docs https://jsreport.net/learn/fs-store

## Installation

> npm install jsreport-fs-store

Then alter jsreport configuration
```js
{
	'store': { 'provider': 'fs' }
}
```

## Development
(This section is intended to jsreport extension developers audience.)

### Entity definitions
Use `splitIntoDirectories` attribute in `registerEntitySet` to use the directory structure for storing. Otherwise the storage will put every entity row into the one single file.

```js
this.documentStore.registerEntitySet("templates", {entityType: "jsreport.TemplateType", splitIntoDirectories: true});
```

Not every jsreport entity should be spitted into the tree structure. It is especially not desired for the entities where you expect thousands of entries.  In this case just remove the `splitIntoDirectories` attribute.

The second required step is to extend the entity type with `publicKey` which is marking the attribute used for the row directory name. And also adding the `document` for the attributes you want to extract into dedicated files.

```js
var templateAttributes = {
	...
    shortid: {type: "Edm.String"},
    name: {type: "Edm.String", publicKey: true},
    content: {type: "Edm.String",
	    document: { extension: "html", engine: true }
	}
    ...      
};
```

### Engines

Engines like handlebars or jade are able to override the default file extension for the template content files. This can be done using file extension resolver....

```js
reporter.documentStore.addFileExtensionResolver(function(doc, entitySetName, entityType, propertyType) {
        if (doc.engine === "handlebars" && propertyType.document.engine) {
            return "handlebars";
        };
    });
```    
