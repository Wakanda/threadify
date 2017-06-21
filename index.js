var DEFAULTS = {
	NAMESPACE: 'WAKANDA::THREADIFY',
	RESPONSE_TIMEOUT: 20000,
	CREATION_TIMEOUT: 20000,
	WORKER_TYPE: 'NodeWorker',
	MAX_WORKERS_PER_CATEGORY: 10
};

var threadify = {
	run: run,
	require: _require
};

function run(params) {
	var worker = reserveWorker(params);
	if (worker === null) {
		throw new Error("NO_FREE_WORKERS");
	}

	var response = runActionAndReleaseWorker(worker, params);
	var result = deserialize(response.type, response.data);

	if (response.type === 'exception') {
		throw result;
	}

	return result;
};

function _require(moduleID, reserved, workerType) {

	var modulePath = getModulePath(moduleID);
	var _reserved = reserved || false;

	workerType = workerType || DEFAULTS.WORKER_TYPE;

	try {
		var _module = require(modulePath);
	} catch (e) {
		throw {
			code: 'REQUIRE_MODULE_ERROR',
			data: {
				moduleID: moduleID,
				modulePath: modulePath,
				exception: e
			}
		}
	}

	for (var propertyName in _module) {
		if (typeof _module[propertyName] === 'function') {
			_module[propertyName] = (function (action) {
				return function (params) {
					return run({
						workerType: workerType,
						reserved: _reserved,
						modulePath: modulePath,
						action: action,
						data: params
					});
				};
			})(propertyName);
		}
	}

	return _module;
};

function runActionAndReleaseWorker(worker, params) {
	var port = worker.port;
	var noResponse = true;
	var connected = false;

	port.onmessage = function (message) {
		response = message.data;

		var kind = response.kind;
		var data = response.data;

		response.id = worker.id;

		if (kind === '__info__' && data === 'connected') {
			connected = true;

			port.postMessage({
				modulePath: params.modulePath,
				reserved: params.reserved,
				action: params.action,
				data: params.data
			});

		} else {
			noResponse = false;

			exitWait();
		}
	};

	wait(DEFAULTS.RESPONSE_TIMEOUT);

	releaseWorker(worker);

	if (noResponse) {
		console.log('TIMEOUT : ' + worker.id + ' connected : ' + connected);
		throw {
			code: 'TIMEOUT'
		};
	}

	return response;
}

function deserialize(type, data) {
	return data;
}

function getStorageKeyFromWorkerInfo(params) {
	var key = DEFAULTS.NAMESPACE + '::' + params.workerType;
	key += (params.reserved) ? '::R::' + params.modulePath : '::NR';

	/**
	 * Reserved     : WAKANDA::THREADIFY::NodeWorker::R::wakanda-cache-redis/redis-wakanda
	 * Not Reserved : WAKANDA::THREADIFY::NodeWorker::NR
	 */
	return key;
}

function getModulePath(moduleID) {
	return moduleID;
}

function reserveWorker(params) {

	var namespaceID = getStorageKeyFromWorkerInfo(params);
	var worker = null;

	try {
		storage.lock();

		var namespace = storage[namespaceID] || {};
		var workers = namespace.workers || {};
		var freeWorkers = workers.free || [];
		var busyWorkers = workers.busy || [];
		var workerInfo = freeWorkers.pop();

		if (!workerInfo && DEFAULTS.MAX_WORKERS_PER_CATEGORY && busyWorkers.length >= DEFAULTS.MAX_WORKERS_PER_CATEGORY) {

			console.log('Worker Number limit reached for the namespace : ' + namespaceID);

			/**
			 *  /!\ Unlock the storage before quiting the function
			 */
			storage.unlock();

			return null;
		} else if (!workerInfo) {

			console.log('Creating Worker for the namespace : ' + namespaceID);

			workerInfo = createWorker(params);
		} else {
			console.log('Found a free worker : ' + workerInfo.id);
		}

		worker = getWorker(workerInfo.workerType, workerInfo.id, params.reserved, params.modulePath);

		busyWorkers.push(workerInfo);
		workers.free = freeWorkers;
		workers.busy = busyWorkers;
		namespace.workers = workers;
		storage[namespaceID] = namespace;

	} catch (e) {
		console.log(e);
	} finally {
		storage.unlock();
	}

	return worker;
}

function releaseWorker(worker) {
	var namespaceID = getStorageKeyFromWorkerInfo(worker);
	console.log('Releasing worker : ' + worker.id);
	console.log('Namespace : ' + namespaceID);

	try {
		storage.lock();

		var namespace = storage[namespaceID];
		var workers = namespace.workers;
		var freeWorkers = workers.free;
		var busyWorkers = workers.busy;

		var workerPosition = -1;

		busyWorkers.some(function (_worker, position) {
			if (_worker.id === worker.id) {
				workerPosition = position;

				return true;
			}
		});

		var workerInfo = busyWorkers.splice(workerPosition, 1)[0];

		freeWorkers.push(workerInfo);
		workers.free = freeWorkers;
		workers.busy = busyWorkers;
		namespace.workers = workers;
		storage[namespaceID] = namespace;
	} catch (e) {
		console.log(e);
	} finally {
		storage.unlock();
	}
}

function getWorker(type, id, reserved, modulePath) {
	var workerPath = File(File(module.filename).parent, './worker.js').path;
	var worker = null;

	if (type === 'SharedWorker') {
		worker = new SharedWorker(workerPath, id);
	} else {
		worker = new NodeWorker(workerPath, id);
	}

	worker.id = id;
	worker.workerType = type;
	worker.reserved = reserved;
	worker.modulePath = modulePath;

	return worker;
}

function createWorker(params) {
	var id = generateUUID();
	var worker = getWorker(params.workerType, id, params.reserved, params.modulePath);
	var port = worker.port;
	var created = false;
	var ready = false;
	var workerInfo = {};

	workerInfo.id = id;
	workerInfo.workerType = params.workerType;
	workerInfo.modulePath = params.modulePath;
	workerInfo.reserved = params.reserved;

	port.onmessage = function (message) {
		var response = message.data;
		var kind = response.kind;
		var data = response.data;
		response.workerID = id;

		if (kind === '__info__' && data === 'connected') {
			created = true;
			if (response.ready) {
				ready = true;
				exitWait();
			} else {
				port.postMessage({
					kind: '__info__',
					action: 'set',
					data: workerInfo
				});
			}
		} else if (created && kind === 'result') {
			ready = true;
			exitWait();
		}
	};

	wait(DEFAULTS.CREATION_TIMEOUT);

	if (!ready) {
		throw {
			code: 'TIMEOUT',
			message: 'worker creation timeout'
		}
	}
	return workerInfo;
}

module.exports = threadify;