var create = require('lodash/object/create');
var compose = require('ksf/utils/compose');
var bindValueDestroyable = require('ksf/observable/bindValueDestroyable');
var PersistableValue = require('ksf/observable/PersistableValue');
var _ContentDelegate = require('absolute/_ContentDelegate');
import _Destroyable from 'ksf/base/_Destroyable'
var Switch = require('absolute/Switch');

var localRequest = require('./utils/LocalRequest')
var ConnectionView = require('./ConnectionView')

export default compose(_ContentDelegate, _Destroyable, function(args) {

	var online = new PersistableValue('online', true); // true or false

	this._content = new Switch()

  this._own(bindValueDestroyable(online, onlineValue => {
    var view
		if (onlineValue) {
      view = new ConnectionView(create(args, {
        goOffline: online.value.bind(online, false),
				menuItemId: null,
      }))
    } else {
      view = new ConnectionView(create (args, {
        goOnline: online.value.bind(online, true),
				request: localRequest(args.localDb),
				menuItemId: 132,
      }))
    }
    this._content.content(view)
    return view
  }, this))
})