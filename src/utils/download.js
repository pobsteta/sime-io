import assign from 'lodash/object/assign'
import countBy from 'lodash/collection/countBy'
import getQgsFile from './getQgsFile'
import getMenuChildren from './getMenuChildren'
import getFieldIdsToRequest from './getFieldIdsToRequest'
import {sublevel, batch, put, del, get as getItem} from './db'
import getIconSvg from './getIconSvg'

// set a limit to prevent accidental huge requests
const resultsLimit = 1000;

function first (array) {
  return array.length ? array[0] : null
}

function get(prop) {
  return function (obj) {
    return obj && obj[prop]
  }
}


function storeItems (db, items) {
    return batch(db, items.map(item => {
      return {type: 'put', key: item.id, value: item}
    }))
}


function getActionFromMenuItem(requestRpc, menuItemId) {
  return requestRpc({
		"method": "model.ir.action.keyword.get_keyword",
		"params": [
			"tree_open",
			["ir.ui.menu", menuItemId],
		],
	}).then(first).then(action =>
    action && action.type === "ir.action.act_window" ? action : null
  )
}

function loadGeoItems(requestRpc, requestWfs, db, modelId, extent, fieldNames) {
  // get an id-list of in-extent items
  // NB: we don't use WFS data because attribute-values are untyped and to ensure consistency
  return requestWfs({
    method: 'getFeature',
    params: {
      type: modelId,
      bbox: extent,
    },
  }).then(features => {
      let idsInExtent = features.map(feature => parseInt(feature.getId().split('.').pop())) // convert id to number, (eg. from 'cg.ug.123' to 123)
      // get an id-list of items with no geometry
      // then download data for all items
      return requestRpc({method: 'model.' + modelId + '.search', params: [
        ['geom', '=', null],
        0,
        resultsLimit,
      ]}).then(idsWithNoGeom => requestRpc({method: 'model.' + modelId + '.read', params: [
          idsInExtent.concat(idsWithNoGeom),
          fieldNames,
        ]}).then(items => storeItems(db, items)))
  })
}

function loadNonGeoItems (requestRpc, db, modelId, fieldNames) {
  return requestRpc({method: 'model.'+modelId+'.search_read', params: [
    [], // all items
    0,
    resultsLimit, // limit
    null,
    fieldNames,
  ]}).then(items => storeItems(db, items))
}

function getViewDef(request, modelId, viewId) {
  var params
  if (viewId === 'tree' || viewId === 'form') {
    params = [null, viewId]
  } else {
    params = [viewId, null]
  }
  return request({method: 'model.'+modelId+'.fields_view_get', params: params})
}


function loadViews(requestRpc, db, modelId) {
  return requestRpc({method: 'model.ir.ui.view.search', params: [
    [["model", "=", modelId]],
		0,
		resultsLimit,
		null,
		[],
  ]}).then(viewIds => viewIds.concat(['tree', 'form'])).then(viewIds =>
    Promise.all(viewIds.map(viewId =>
      getViewDef(requestRpc, modelId, viewId)
    )).then(function (viewDefs) {
      return storeItems(db, viewIds.map(function (viewId, i) {
        return assign(viewDefs[i], {id: viewId})
      }))
    })
  )
}

function loadModelDefaultValue(requestRpc, db, modelId, props) {
  requestRpc({method: 'model.'+modelId+'.default_get', params: [
			props,
		]}).then(defaultValue => put(db, 'defaultValue', defaultValue))
}

function getModelDef(requestRpc, modelId) {
  return requestRpc({method: 'model.ir.model.search_read', params: [
    [["model", "=", modelId]],
		0,
		1,
		null,
		[],
  ]}).then(first).then(modelDef => {
    return getModelFields(requestRpc, modelDef.id).then(fields => {
      modelDef.fields = fields
      return modelDef
    })
  })
}

function getModelFields(requestRpc, modelDbId) {
  return requestRpc({method: 'model.ir.model.field.search_read', params: [
    [["model", "=", modelDbId]],
		0,
		resultsLimit,
		null,
		[],
  ]})
}

function loadItemAttachementCounts(request, db, modelId) {
  return request({method: 'model.ir.attachment.search_read', params: [
    [["resource", ">=", modelId+","], ["resource", "<=", modelId+",a"]], // permet de récupérer en une requête toutes les pièces jointes de tous les éléments d'un model
    0,
    10000, // pas de problème de taille de réponse
    null,
    ['resource'],
  ]}).then((resp) =>
    countBy(resp, (attachment) =>
      attachment.resource && attachment.resource.split(',')[1] // get itemId
    )
  ).then((counts) =>
    batch(sublevel(db, 'itemAttachmentCounts'), Object.keys(counts).map(itemId => {
      return {type: 'put', key: itemId, value: counts[itemId]}
    }))
  )
}

function loadModelIfNecessary(requestRpc, requestWfs, modelsDb, modelId, extent) {
  return getItem(modelsDb, modelId+'/modelDef').then(
    () => Promise.resolve(), // ce model a déjà été chargé
    () => loadModel(requestRpc, requestWfs, modelsDb, modelId, extent) // ce model n'a pas encore été chargé
  )
}

function loadModel (requestRpc, requestWfs, modelsDb, modelId, extent) {
  var db = sublevel(modelsDb, modelId)
  return Promise.all([
    loadViews(requestRpc, sublevel(db, 'views'), modelId),
    loadItemAttachementCounts(requestRpc, db, modelId),
    getModelDef(requestRpc, modelId).then(modelDef => Promise.all([
      put(db, 'modelDef', modelDef),
      put(modelsDb, 'dbIds/'+modelDef.id, modelId), // index modelDbId > modelId
      loadModelDefaultValue(requestRpc, db, modelId, modelDef.fields.map(get('name'))),
      getQgsFile(requestRpc, modelId).then(qgsFile => {
        var fieldNames = getFieldIdsToRequest(modelDef.fields)
        if (qgsFile) {
          return Promise.all([
            put(db, 'qgsFile', window.btoa(qgsFile)),
            loadGeoItems(requestRpc, requestWfs, sublevel(db, 'items'), modelId, extent, fieldNames),
          ])
        } else {
          return Promise.all([
            del(db, 'qgsFile'), // be sure to remove existing file if any
            loadNonGeoItems(requestRpc, sublevel(db, 'items'), modelId, fieldNames),
          ])
        }
      }),
    ])),
  ])
}


function loadMenuItemAction(requestRpc, requestWfs, db, menuItemId, extent) {
  return getActionFromMenuItem(requestRpc, menuItemId).then(action => {
    if (action) {
      var modelId = action['res_model']
      return Promise.all([
        put(db, 'menuItemActions/'+menuItemId, action),
        loadModelIfNecessary(requestRpc, requestWfs, sublevel(db, 'models'), modelId, extent),
      ])
    } else {
      return Promise.resolve(true)
    }
  })
}

function getMenuItemValue (requestRpc, menuItemId) {
  return requestRpc({"method": "model.ir.ui.menu.read", "params": [
    [menuItemId],
    ['parent', 'name', 'complete_name', 'childs', 'icon', 'action', 'sequence'],
  ]}).then(res => res[0])
}

function loadMenuItemValue(requestRpc, db, menuItemId) {
  return getMenuItemValue(requestRpc, menuItemId).then(menuItemValue =>
    Promise.all([
      put(db, 'menuItemValues/'+menuItemId, menuItemValue),
      loadIconIfNecessary(requestRpc, db, menuItemValue.icon),
    ])
  )
}

function loadIconIfNecessary(request, db, iconName) {
  return db.get('icons/'+iconName).then(
    () => Promise.resolve(true), // elle existe déjà, pas besoin de la redemander
    () => loadIcon(request, db, iconName)
  )
}

function loadIcon(request, db, iconName) {
  return getIconSvg(request, iconName).then(icon => db.put('icons/'+iconName, icon))
}

function loadMenuItem(requestRpc, requestWfs, db, menuItemId, extent) {
  return Promise.all([
    loadMenuItemValue(requestRpc, db, menuItemId),
    loadMenuItemAction(requestRpc, requestWfs, db, menuItemId, extent),
  ])
}


function loadMenuTree(requestRpc, requestWfs, db, menuItemId, extent) {
  return Promise.all([
    loadMenuItem(requestRpc, requestWfs, db, menuItemId, extent),
    getMenuChildren(requestRpc, menuItemId).then(menuItems => {
      return Promise.all(menuItems.map(menuItem => loadMenuTree(requestRpc, requestWfs, db, menuItem.id, extent)))
    }),
  ])
}

export default loadMenuTree
