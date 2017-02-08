var DEFAULTS = {
	NAMESPACE                : 'WAKANDA::THREADIFY',
	QUEUE                    : true,
	RESPONSE_TIMEOUT         : 20000,
	CREATION_TIMEOUT         : 20000,
	WORKER_TYPE              : 'NodeWorker',
	MAX_WORKERS_PER_CATEGORY : 10
};

var threadify = {
	run     : run,
	require : _require	
};

function run(params){
	var worker   = reserveWorker(params);	
	var response = runActionAndReleaseWorker(worker, params);
	var result   = deserialize(response.type, response.data);
	      
	if(response.kind === 'exception'){
		throw result;
	}
	
	return result;	
};

function _require(moduleID, reserved, workerType){
	
	var modulePath = getModulePath(moduleID);
	var _reserved  = reserved || false;
	
	workerType = workerType || DEFAULTS.WORKER_TYPE;
	
	try{
		var _module = require(modulePath);
	}catch(e){
		throw {
			code : 'REQUIRE_MODULE_ERROR',
			data : {
				moduleID   : moduleID,
				modulePath : modulePath,
				exception  : e
			}
		}
	}
	
	for(var propertyName in _module){
		if(typeof _module[propertyName] === 'function'){
			_module[propertyName] = (function(action){
				return function(params){
					return run({
						workerType : workerType,
						reserved   : _reserved,
						modulePath : modulePath,
						action	   : action,
						data	   : params
					});
				};
			})(propertyName);
		}
	}
	
	return _module;
};

function runActionAndReleaseWorker(worker, params){
	var port = worker.port;
	var noResponse = true;
	
	port.onmessage = function(message){	
		response	= message.data;
		
		var type = response.type;
		var data = response.data;
		
		if(type === '__info__' && data === 'ready'){
			connected = true;
			
			port.postMessage({
				modulePath : params.modulePath,
				reserved   : params.reserved,
				action 	   : params.action,
				data       : params.data
			});
		} else {
			
			noResponse	= false;		
			
			exitWait();
		}		
	};
	
	wait(DEFAULTS.RESPONSE_TIMEOUT);

	releaseWorker(worker);
	
	if(noResponse){
		console.log('TIMEOUT');
		throw {
			code : 'TIMEOUT'
		};
	}
	
	return response;
}

function deserialize(type, data){
	return data;
}

function getStorageKeyFromWorkerInfo(params){
	var key = DEFAULTS.NAMESPACE + '::' + params.workerType;
	key+= (params.reserved) ? '::R::' + params.modulePath : '::NR';
	
	/**
	 * Reserved     : WAKANDA::THREADIFY::NodeWorker::R::wakanda-cache-redis/redis-wakanda
	 * Not Reserved : WAKANDA::THREADIFY::NodeWorker::NR
	 */
	return key;
}

function getModulePath(moduleID){
	return moduleID;
}

function reserveWorker(params){
	
	var namespaceID = getStorageKeyFromWorkerInfo(params);
	var worker      = null;
	
	try {
		storage.lock();
			
		var namespace 	= storage[namespaceID] || {};
		var workers     = namespace.workers || {};
		var freeWorkers	= workers.free || [];
		var busyWorkers = workers.busy || [];
		var workerInfo	= freeWorkers.pop();
		
		if(!workerInfo && freeWorkers.length >= DEFAULTS.MAX_WORKERS_PER_CATEGORY){
			
			console.log('Worker Number limit reached for the namespace : ' + namespaceID);
			
			return null;
		} else if (!workerInfo) {
			
			console.log('Creating Worker for the namespace : ' + namespaceID);
			
			workerInfo = createWorker(params);
		}
		
		worker = getWorker(workerInfo.workerType, workerInfo.id, params.reserved, params.modulePath);
		
		busyWorkers.push(workerInfo);		
		workers.free         = freeWorkers;
		workers.busy         = busyWorkers;	
		namespace.workers    = workers;
		storage[namespaceID] = namespace;		
		
	} catch(e){
		console.log(e);
	} finally {
		storage.unlock();
	}
	
	return worker;
}

function releaseWorker(worker){
	var namespaceID = getStorageKeyFromWorkerInfo(worker);

	try {
		storage.lock();
		
		var namespace 	= storage[namespaceID];
		var workers     = namespace.workers;
		var freeWorkers	= workers.free;
		var busyWorkers = workers.busy;
		
		var workerPosition = -1;
		
		busyWorkers.some(function(_worker, position){
			if(_worker.id === worker.id){
				workerPosition = position;
				
				return true;
			}
		});
		
		var workerInfo = busyWorkers.splice(workerPosition, 1)[0];
		
		freeWorkers.push(workerInfo);
		workers.free         = freeWorkers;
		workers.busy         = busyWorkers;	
		namespace.workers    = workers;
		storage[namespaceID] = namespace;
	} catch(e){
		console.log(e);
	} finally {
		storage.unlock();
	}	
}

function getWorker(type, id, reserved, modulePath){
	var workerPath	= File( File(module.filename).parent , './worker.js').path;
	var worker		= null;
	
	if(type === 'NodeWorker'){
		worker = new NodeWorker(workerPath, id);
	} else {
		worker = new SharedWorker(workerPath, id);
	}
	
	worker.workerType = type;
	worker.id         = id;
	worker.reserved   = reserved;
	worker.modulePath = modulePath;
	
	return worker;
}

function createWorker(params){
	var id		   = generateUUID();
	var worker	   = getWorker(params.workerType, id, params.reserved, params.modulePath);
	var port	   = worker.port;
	var created	   = false;
	var workerInfo = {};
	
	port.onmessage = function(message){
		var response	= message.data;
		var type		= response.type;
		var data		= response.data;

		if(params.reserved && type === '__info__' && data === 'ready'){
			port.postMessage({
				action   : '__init__',
				data     : params,
				reserved : params.reserved
			});
		} else {
			/*
			 * Received an error or a ready
			 * TODO : Handle errors
			 */
			created = true;
			exitWait();
		}
		
	};
	
	wait(DEFAULTS.CREATION_TIMEOUT);
	
	if(!created){
		throw {
			code    : 'TIMEOUT',
			message : 'worker creation timeout'
		}
	}

	workerInfo.id         = id;
	workerInfo.workerType = params.workerType;
	workerInfo.modulePath = params.modulePath;
	workerInfo.reserved   = params.reserved;
	
	return workerInfo;
}

module.exports = threadify;