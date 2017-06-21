var MAX_ACTION_WAIT = 20000;
var info = null;

onconnect = function (event) {
	var port = event.ports[0];

	port.onmessage = function (message) {
		var request = message.data;
		if (!request) {
			console.log('This should not happen!');
			sendError(port, {
				'CODE': 'INTERNAL_ERROR',
				'message': 'empty request'
			});
			return;
		}

		console.log(JSON.stringify({
			kind: request.kind,
			action: request.action,
			data: request.data
		}));

		handleRequest(port, request);
	};

	port.postMessage({
		ready: info !== null,
		data: 'connected',
		kind: '__info__'
	});
};

function handleRequest(port, request) {
	switch (request.kind) {
		case '__info__':
			handleInfo(port, request);
			break;
		default:
			handleAction(port, request);
	}
}

function handleInfo(port, request) {
	var action = request.action;
	var data = request.data;

	switch (action) {
		case 'set':
			info = data;
			sendResult(port);
			break;
		case 'get':
			sendResult(port, info);
			break;
	}
}

function handleAction(port, request) {
	var action = request.action;
	var data = request.data;
	var actions;

	try {
		actions = require(request.modulePath);
	} catch (e) {
		console.log('couldn\'t require the module [' + data.module + ']');

		sendError(port, {
			'code': 'MODULE_REQUIRE_ERROR',
			'data': e
		});
		return;
	}

	if (!actions) {
		sendError(port, {
			'code': 'MODULE_REQUIRE_ERROR',
			'data': 'Empty Module'
		});
	}

	if (actions['__inited__'] !== true) {
		if (typeof actions['init'] === 'function') {
			try {
				if (actions.init.length >= 1) {
					actions.init(function (error) {
						if (error) {
							sendError(port, {
								'code': 'MODULE_INIT_ERROR',
								'data': error
							});

							/**
							 *  /!\ Quit if the initialization failed
							 */
							return;
						}
					});
				} else {
					actions.init();
				}
			} catch (e) {
				console.log('An error occured during the initialization of : ' + data.module);

				sendError(port, {
					'code': 'MODULE_INIT_ERROR',
					'data': e
				});

				/**
				 *  /!\ Quit if the initialization failed
				 */
				return;
			}
		}

		actions['__inited__'] = true;
	}

	runAction({ actions, port, data, action });
}

function runAction({ actions, port, data, action }) {
	if (typeof actions[action] === 'undefined') {
		sendError(port, {
			'code': 'UNKNOWN_ACTION',
			'data': {
				'modulePath': data.modulePath,
				'action': action
			}
		});

		return;
	}
	if (actions[action].length >= 2) {
		try {
			actions[action](data,
				function (error, result) {
					if (error) {
						sendError(port, {
							'code': 'RUNTIME',
							'data': error.toString()
						});
						return;
					} else {
						sendResult(port, result);
					}
				});
		} catch (e) {
			sendError(port, {
				'code': 'RUNTIME',
				'data': e.toString()
			});
			return;
		}
	} else {
		var result;
		try {
			result = actions[action](data);
		} catch (e) {
			sendError(port, {
				'code': 'RUNTIME',
				'data': e.toString()
			});
			return;
		}
		sendResult(port, result);
	}
}

function sendError(port, error) {
	sendMessage({ port, kind: 'result', type: 'exception', data: error });
}

function sendResult(port, result) {
	sendMessage({ port, kind: 'result', data: result });
}

function sendMessage({ port, kind, data, type }) {
	port.postMessage({
		'kind': kind,
		'type': type || getTypeOfData(data),
		'data': data
	});
}

function getTypeOfData(data) {
	return typeof (data);
}
