var compose = require('ksf/utils/compose');
var _Destroyable = require('ksf/base/_Destroyable');
var bindValue = require('ksf/observable/bindValue');
var create = require('lodash/object/create');
var _ContentDelegate = require('absolute/_ContentDelegate');
var VFlex = require('absolute/VFlex');
var HFlex = require('absolute/HFlex');
var Switch = require('absolute/Switch');
var Label = require('absolute/Label');
var Button = require('absolute/Button');
import VPile from 'absolute/VPile'
var LabelInput = require('absolute/LabelInput');

var ModelView = require('./ModelView');
var Menu = require('./Menu');
var Saver = require('./utils/Saver');
var SidePanelContainer = require('./SidePanelContainer');

import trytonLogin from './utils/trytonLogin'

import OfflineDashboard from './OfflineDashboard'

/**
Vue qui affiche le menu et une zone principale
@params args {
	request
}
*/
module.exports = compose(_ContentDelegate, _Destroyable, function(args) {
	var self = this
	var session = args.session

	if (args.online) {
		this._own(bindValue(session, function(sessionToken) {
			if (!sessionToken) {
				var passwordInput;
				var authenticationMessage = new Label();
				args.modal(new VPile().width(200).content([
					passwordInput = new LabelInput().placeholder("password").height(30),
					new Button().value("OK").height(30).onAction(function() {
						authenticationMessage.value('authenticating...');
						var pwd = passwordInput.value();
						trytonLogin(args.connectionValue, session, pwd).then(function() {
							authenticationMessage.value('authenticated');
							args.modal(null);
							args.passwordValue.value(pwd);
						}, function() {
							authenticationMessage.value('authentication error');
						});
					}),
					authenticationMessage.height(30),
				]))
			}
		}))

	}

	var commonArgs = create(args, {
		changes: {
			geom: null,
			attrs: {},
		},
	});
	commonArgs.saver = new Saver(commonArgs)
	var mainArea = new Switch();
	var message = new Label();
	var panelContainer = this._content = new SidePanelContainer({
		panel: new VFlex([
				this._menu = new Menu(create(commonArgs, {
					onDisplayModel: function(modelId, listViewId, formViewId) {
						mainArea.content(self._own(new ModelView(create(commonArgs, {
							modelId: modelId,
							listViewId: listViewId,
							formViewId: formViewId,
							message: message,
						})), 'mainView'));
						panelContainer.focusArea('main');
					},
					message: message,
				})).width(300),
				[new Button().value("Gestion du mode hors-ligne").onAction(function() {
						mainArea.content(self._own(new OfflineDashboard(create(commonArgs, {
							offlineMenuItemId: args.offlineMenuItemId,
							message: message,
						})), 'mainView'));
						panelContainer.focusArea('main');
					}).height(args.defaultButtonSize), 'fixed'],
				[new HFlex([
					args.online ?
						new Button().value("Passer hors ligne").onAction(args.goOffline):
						new Button().value("Passer en ligne").onAction(args.goOnline),
					new Button().value("Déconnexion").onAction(args.logout),
				]).height(args.defaultButtonSize), 'fixed'],
				[message.height(30), 'fixed'],
			]),
		options: {
			panelPosition: 'left',
			panelOpen: true,
		},
		main: mainArea.depth(100),
	});
});
