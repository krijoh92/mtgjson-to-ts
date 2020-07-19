import {camelCase, capitalCase} from 'change-case'
import fetch from 'node-fetch'
import {compileFromFile} from 'json-schema-to-typescript'
import {writeFileSync, unlinkSync} from 'fs'

const baseUrl =
  'https://github.com/mtgjson/mtgjson-website/raw/master/docs/.vuepress/public/schemas'

const files = [
  'card',
  'cardTypes',
  'compiledList',
  'deck',
  'files',
  'foreignData',
  'identifiers',
  'keywords',
  'leadershipSkills',
  'legalities',
  'meta',
  'purchaseUrls',
  'rulings',
  'set',
  'translations',
  'types',
]

async function doCompile() {
  const ts = await compileFromFile(`./all.schema.json`, {
    style: {semi: false, trailingComma: 'es5', singleQuote: true, tabWidth: 2},
  })

  writeFileSync(`./mtgjson.ts`, ts)
}

function fixTypeRef(data: any) {
  const refRegexp = new RegExp(/link@([^}}]{1,})@\/data-models/)
  if (data.example) {
    const exampleTypes = data.example.replace(/\[\]/, '').split(',')
    const matches = exampleTypes.map(t => t.match(refRegexp)).filter(t => t)

    const itemRefs = []

    for (const match of matches) {
      const typeRef = camelCase(match[1].replace(/\(.{1,}\)/, ''))
      itemRefs.push({$ref: `#/definitions/${typeRef}`})
    }
    data.items = itemRefs.length > 1 ? itemRefs : itemRefs[0]
  }
}

function fixBrokenFields(data: any) {
  const arrayRegxp = new RegExp(/array\((string|object)\)/)

  for (const key of Object.keys(data)) {
    if (typeof data[key] === 'object') {
      fixBrokenFields(data[key])
    } else {
      if (key === 'type') {
        const fieldTypes = data[key].split('|').map(t => t.replace(/\s/, ''))
        if (data[key].match(arrayRegxp)) {
          const typeLine =
            fieldTypes.filter(t => t.includes('array')).length === fieldTypes.length
              ? 'array'
              : fieldTypes.map(t => (t.includes('array') ? 'array' : t))

          let itemType: string | undefined

          for (const item of fieldTypes.filter(t => t.match(arrayRegxp))) {
            const [_, matchType] = item.match(arrayRegxp)
            itemType = matchType
          }

          if (itemType === 'string') {
            data.items = {type: itemType}
            data[key] = typeLine
          } else if (itemType === 'object') {
            data[key] = typeLine
            fixTypeRef(data)
          }
        } else if (data[key] === 'object') {
          fixTypeRef(data)
        } else {
          data[key] = fieldTypes.length === 1 ? fieldTypes[0] : fieldTypes
        }
      }

      if (key === 'type' && data[key] === 'float') {
        data[key] = 'number'
      }
    }

    // Uncomment when https://github.com/bcherny/json-schema-to-typescript/issues/193 is fixed
    if (['description', 'examples'].includes(key)) {
      delete data[key]
      continue
    }
  }
}

function findRequiredFields(data: any) {
  const required = []

  for (const key of Object.keys(data)) {
    if (!data[key].attributes) {
      required.push(key)
    }
  }

  return required.length === 0 ? undefined : required
}

async function downloadFiles() {
  const jsonData: any = {
    type: 'object',
    title: 'MTGJSON',
    schema: 'http://json-schema.org/draft-07/schema',
    properties: {},
    definitions: {},
  }

  for (const file of files) {
    const res = await fetch(`${baseUrl}/${file}.schema.json`)
    const json = await res.json()

    const id = `#/definitions/${file}`
    fixBrokenFields(json)
    const required = findRequiredFields(json)

    jsonData.definitions[file] = {properties: json, $id: id, title: capitalCase(file), required}
    jsonData.properties[file] = {$ref: id}
  }

  writeFileSync('./all.schema.json', JSON.stringify(jsonData, undefined, 2))
  doCompile()
  unlinkSync('./all.schema.json')
}

downloadFiles()
