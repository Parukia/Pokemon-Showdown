/**
 * Command parser
 * Pokemon Showdown - http://pokemonshowdown.com/
 *
 * This is the command parser. Call it with CommandParser.parse
 * (scroll down to its definition for details)
 *
 * Individual commands are put in:
 *   commands.js - "core" commands that shouldn't be modified
 *   config/commands.js - other commands that can be safely modified
 *
 * The command API is (mostly) documented in config/commands.js
 *
 * @license MIT license
 */

/*

To reload chat commands:

/hotpatch chat

*/

const MAX_MESSAGE_LENGTH = 300;

const BROADCAST_COOLDOWN = 20 * 1000;

const MESSAGE_COOLDOWN = 5 * 60 * 1000;

const MAX_PARSE_RECURSION = 10;

var fs = require('fs');

/*********************************************************
 * Load command files
 *********************************************************/

var commands = exports.commands = require('./commands.js').commands;

var customCommands = require('./config/commands.js');
if (customCommands && customCommands.commands) {
	Object.merge(commands, customCommands.commands);
}

// Install plug-in commands

fs.readdirSync('./chat-plugins').forEach(function (file) {
	if (file.substr(-3) === '.js') Object.merge(commands, require('./chat-plugins/' + file).commands);
});

/*********************************************************
 * Parser
 *********************************************************/

var modlog = exports.modlog = {lobby: fs.createWriteStream('logs/modlog/modlog_lobby.txt', {flags:'a+'}), battle: fs.createWriteStream('logs/modlog/modlog_battle.txt', {flags:'a+'})};

/**
 * Can this user talk?
 * Shows an error message if not.
 */
function canTalk(user, room, connection, message) {
	if (!user.named) {
		connection.popup("You must choose a name before you can talk.");
		return false;
	}
	if (room && user.locked) {
		connection.sendTo(room, "You are locked from talking in chat.");
		return false;
	}
	if (room && user.mutedRooms[room.id]) {
		connection.sendTo(room, "You are muted and cannot talk in this room.");
		return false;
	}
	var roomType = room && room.auth ? room.type + 'Room' : 'global';
	if (room && room.modchat) {
		if (room.modchat === 'crash') {
			if (!user.can('ignorelimits')) {
				connection.sendTo(room, "Because the server has crashed, you cannot speak in lobby chat.");
				return false;
			}
		} else {
			var userGroup = user.group;
			if (room.auth) {
				if (room.auth[user.userid]) {
					userGroup = room.auth[user.userid];
				} else if (room.isPrivate) {
					userGroup = Config.groups.default[roomType];
				}
			}
			if (room.modchat === 'autoconfirmed') {
				if (!user.autoconfirmed && userGroup === Config.groups.default[roomType]) {
					connection.sendTo(room, "Because moderated chat is set, your account must be at least one week old and you must have won at least one ladder game to speak in this room.");
					return false;
				}
			} else if (Config.groups.bySymbol[userGroup].rank < Config.groups.bySymbol[room.modchat].rank) {
				var groupName = Config.groups.bySymbol[room.modchat].name || room.modchat;
				connection.sendTo(room, "Because moderated chat is set, you must be of rank " + groupName + " or higher to speak in this room.");
				return false;
			}
		}
	}
	if (room && !(user.userid in room.users)) {
		connection.popup("You can't send a message to this room without being in it.");
		return false;
	}

	if (typeof message === 'string') {
		if (!message) {
			connection.popup("Your message can't be blank.");
			return false;
		}
		if (message.length > MAX_MESSAGE_LENGTH && !user.can('ignorelimits')) {
			connection.popup("Your message is too long:\n\n" + message);
			return false;
		}

		// remove zalgo
		message = message.replace(/[\u0300-\u036f\u0483-\u0489\u0E31\u0E34-\u0E3A\u0E47-\u0E4E]{3,}/g, '');

		if (room && room.id === 'lobby') {
			var normalized = message.trim();
			if ((normalized === user.lastMessage) &&
					((Date.now() - user.lastMessageTime) < MESSAGE_COOLDOWN)) {
				connection.popup("You can't send the same message again so soon.");
				return false;
			}
			user.lastMessage = message;
			user.lastMessageTime = Date.now();
		}

		if (Config.chatFilter) {
			return Config.chatFilter(user, room, connection, message);
		}
		return message;
	}

	return true;
}

/**
 * Command parser
 *
 * Usage:
 *   CommandParser.parse(message, room, user, connection)
 *
 * message - the message the user is trying to say
 * room - the room the user is trying to say it in
 * user - the user that sent the message
 * connection - the connection the user sent the message from
 *
 * Returns the message the user should say, or a falsy value which
 * means "don't say anything"
 *
 * Examples:
 *   CommandParser.parse("/join lobby", room, user, connection)
 *     will make the user join the lobby, and return false.
 *
 *   CommandParser.parse("Hi, guys!", room, user, connection)
 *     will return "Hi, guys!" if the user isn't muted, or
 *     if he's muted, will warn him that he's muted, and
 *     return false.
 */
var parse = exports.parse = function (message, room, user, connection, levelsDeep) {
	var cmd = '', target = '';
	if (!message || !message.trim().length) return;
	if (!levelsDeep) {
		levelsDeep = 0;
		// if (Config.emergencyLog && (connection.ip === '62.195.195.62' || connection.ip === '86.141.154.222' || connection.ip === '189.134.175.221' || message.length > 2048 || message.length > 256 && message.substr(0, 5) !== '/utm ' && message.substr(0, 5) !== '/trn ')) {
		if (Config.emergencyLog && (user.userid === 'pindapinda' || connection.ip === '62.195.195.62' || connection.ip === '86.141.154.222' || connection.ip === '189.134.175.221')) {
			Config.emergencyLog.write('<' + user.name + '@' + connection.ip + '> ' + message + '\n');
		}
	} else {
		if (levelsDeep > MAX_PARSE_RECURSION) {
			return connection.sendTo(room, "Error: Too much recursion");
		}
	}

	if (message.substr(0, 3) === '>> ') {
		// multiline eval
		message = '/eval ' + message.substr(3);
	} else if (message.substr(0, 4) === '>>> ') {
		// multiline eval
		message = '/evalbattle ' + message.substr(4);
	}

	if (message.charAt(0) === '/' && message.charAt(1) !== '/') {
		var spaceIndex = message.indexOf(' ');
		if (spaceIndex > 0) {
			cmd = message.substr(1, spaceIndex - 1);
			target = message.substr(spaceIndex + 1);
		} else {
			cmd = message.substr(1);
			target = '';
		}
	} else if (message.charAt(0) === '!') {
		var spaceIndex = message.indexOf(' ');
		if (spaceIndex > 0) {
			cmd = message.substr(0, spaceIndex);
			target = message.substr(spaceIndex + 1);
		} else {
			cmd = message;
			target = '';
		}
	}
	cmd = cmd.toLowerCase();
	var broadcast = false;
	if (cmd.charAt(0) === '!') {
		broadcast = true;
		cmd = cmd.substr(1);
	}

	var commandHandler = commands[cmd];
	if (typeof commandHandler === 'string') {
		// in case someone messed up, don't loop
		commandHandler = commands[commandHandler];
	}
	if (commandHandler) {
		var context = {
			sendReply: function (data) {
				if (this.broadcasting) {
					room.add(data, true);
				} else {
					connection.sendTo(room, data);
				}
			},
			sendReplyBox: function (html) {
				this.sendReply('|raw|<div class="infobox">' + html + '</div>');
			},
			popupReply: function (message) {
				connection.popup(message);
			},
			add: function (data) {
				room.add(data, true);
			},
			send: function (data) {
				room.send(data);
			},
			privateModCommand: function (data, noLog) {
				this.sendModCommand(data);
				this.logEntry(data);
				this.logModCommand(data);
			},
			sendModCommand: function (data) {
				for (var i in room.users) {
					var user = room.users[i];
					if (user.can('staff') || user.can('staff', room)) {
						user.sendTo(room, data);
					}
				}
			},
			logEntry: function (data) {
				room.logEntry(data);
			},
			addModCommand: function (text, logOnlyText) {
				this.add(text);
				this.logModCommand(text + (logOnlyText || ""));
			},
			logModCommand: function (result) {
				if (!modlog[room.id]) {
					if (room.battle) {
						modlog[room.id] = modlog['battle'];
					} else {
						modlog[room.id] = fs.createWriteStream('logs/modlog/modlog_' + room.id + '.txt', {flags:'a+'});
					}
				}
				modlog[room.id].write('[' + (new Date().toJSON()) + '] (' + room.id + ') ' + result + '\n');
			},
			can: function (permission, target, room) {
				if (!user.can(permission, target, room)) {
					this.sendReply("/" + cmd + " - Access denied.");
					return false;
				}
				return true;
			},
			canBroadcast: function (suppressMessage) {
				if (broadcast) {
					message = this.canTalk(message);
					if (!message) return false;
					if (!user.can('broadcast', room)) {
						connection.sendTo(room, "You need to be voiced to broadcast this command's information.");
						connection.sendTo(room, "To see it for yourself, use: /" + message.substr(1));
						return false;
					}

					// broadcast cooldown
					var normalized = toId(message);
					if (room.lastBroadcast === normalized &&
							room.lastBroadcastTime >= Date.now() - BROADCAST_COOLDOWN) {
						connection.sendTo(room, "You can't broadcast this because it was just broadcast.");
						return false;
					}
					this.add('|c|' + user.getIdentity(room.id) + '|' + (suppressMessage || message));
					room.lastBroadcast = normalized;
					room.lastBroadcastTime = Date.now();

					this.broadcasting = true;
				}
				return true;
			},
			parse: function (message) {
				return parse(message, room, user, connection, levelsDeep + 1);
			},
			canTalk: function (message, relevantRoom) {
				var innerRoom = (relevantRoom !== undefined) ? relevantRoom : room;
				return canTalk(user, innerRoom, connection, message);
			},
			canHTML: function (html) {
				html = '' + (html || '');
				var images = html.match(/<img\b[^<>]*/ig);
				if (!images) return true;
				for (var i = 0; i < images.length; i++) {
					if (!/width=([0-9]+|"[0-9]+")/i.test(images[i]) || !/height=([0-9]+|"[0-9]+")/i.test(images[i])) {
						this.sendReply("All images must have a width and height attribute");
						return false;
					}
				}
				return true;
			},
			targetUserOrSelf: function (target, exactName) {
				if (!target) {
					this.targetUsername = user.name;
					return user;
				}
				this.splitTarget(target, exactName);
				return this.targetUser;
			},
			getLastIdOf: function (user) {
				if (typeof user === 'string') user = Users.get(user);
				return (user.named ? user.userid : (Object.keys(user.prevNames).last() || user.userid));
			},
			splitTarget: function (target, exactName) {
				var commaIndex = target.indexOf(',');
				if (commaIndex < 0) {
					var targetUser = Users.get(target, exactName);
					this.targetUser = targetUser;
					this.targetUsername = targetUser ? targetUser.name : target;
					return '';
				}
				var targetUser = Users.get(target.substr(0, commaIndex), exactName);
				if (!targetUser) {
					targetUser = null;
				}
				this.targetUser = targetUser;
				this.targetUsername = targetUser ? targetUser.name : target.substr(0, commaIndex);
				return target.substr(commaIndex + 1).trim();
			}
		};

		var result = commandHandler.call(context, target, room, user, connection, cmd, message);
		if (result === undefined) result = false;

		return result;
	} else {
		// Check for mod/demod/admin/deadmin/etc depending on the group ids
		var isRoom = false;
		var promoteCmd = cmd;
		if (promoteCmd.substr(0, 4) === 'room') {
			isRoom = true;
			promoteCmd = promoteCmd.slice(4);
		}
		for (var g in Config.groups[isRoom ? room.type + 'Room' : 'global']) {
			var groupId = Config.groups.bySymbol[g].id;
			var isDemote = promoteCmd === 'de' + groupId || promoteCmd === 'un' + groupId;
			if (promoteCmd === groupId || isDemote) {
				return parse('/' + (isRoom ? 'room' : '') + (isDemote ? 'demote' : 'promote') + ' ' + toId(target) + (isDemote ? '' : ',' + g), room, user, connection);
			}
		}

		if (message.substr(0, 1) === '/' && cmd) {
			// To guard against command typos, we now emit an error message
			return connection.sendTo(room.id, "The command '/" + cmd + "' was unrecognized. To send a message starting with '/" + cmd + "', type '//" + cmd + "'.");
		}
	}

	if (message.charAt(0) === '/' && message.charAt(1) !== '/') {
		message = '/' + message;
	}
	message = canTalk(user, room, connection, message);
	if (!message) return false;
	if (message.charAt(0) === '/' && message.charAt(1) !== '/') {
		return parse(message, room, user, connection, levelsDeep + 1);
	}

	return message;
};

exports.package = {};
fs.readFile('package.json', function (err, data) {
	if (err) return;
	exports.package = JSON.parse(data);
});

exports.uncacheTree = function (root) {
	var uncache = [require.resolve(root)];
	function getFilename(module) {
		return module.filename;
	}
	do {
		var newuncache = [];
		for (var i = 0; i < uncache.length; ++i) {
			if (require.cache[uncache[i]]) {
				newuncache.push.apply(newuncache,
					require.cache[uncache[i]].children.map(getFilename)
				);
				delete require.cache[uncache[i]];
			}
		}
		uncache = newuncache;
	} while (uncache.length > 0);
};
