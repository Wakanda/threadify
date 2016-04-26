var DEFAULTS = {
	"NAMESPACE" 		: "_THREADIFY",
	"QUEUE"				: true,
	"RESPONSE_TIMEOUT"	: 5000,
	"CREATION_TIMEOUT"	: 5000,
	"WORKER_TYPE"		: "SharedWorker"
};

var threadify = {};
module.exports = threadify;

threadify.start = function(params){
	var info	= {};
	
	info.module			= params.module;
	info.workerType		= (typeof params.workerType === "undefined") ? DEFAULTS.WORKER_TYPE : params.workerType;
	info.count			= params.count || 1;
	info.namespace		= (typeof params.namespace === "undefined") ? DEFAULTS.NAMESPACE : params.namespace;	
	
	createNamespace(info);
	
	for(var i = 0 ; i < info.count ; ++i){
		var workerID = startWorker(info);
		
		storeWorkerState(info.namespace, workerID, "free");
	}
};

threadify.run	= function(params){
	var namespace	= (typeof params.namespace === "undefined") ? DEFAULTS.NAMESPACE : params.namespace;
	var _wait		= (typeof params.queue === "undefined") ? DEFAULTS.QUEUE : params.queue;	
	var connected	= false;
	var noResponse  = true;
	var worker		= null;
	var response;	
	
	while(worker===null){
		worker = reserveWorker(namespace);
		if(worker===null && _wait === false){
			throw {
				"code" : "NO_FREE_WORKER"
			}
		} else if(worker===null && _wait === true){
			wait(100);
		}
	}
		
	var port = worker.port;
	
	port.onmessage = function(message){		
		response	= message.data;
		
		var type		= response.type;
		var data		= response.data;
		
		if(type === "__info__" && data === "ready"){
			connected = true;
			
			port.postMessage({
				"action" 	: params.action,
				"data"		: params.data
			});
		} else {
			
			noResponse	= false;		
			
			exitWait();
		}		
	};
	
	wait(DEFAULTS.RESPONSE_TIMEOUT);

	releaseWorker(namespace, worker.id);
	
	if(noResponse){
		console.log("TIMEOUT");
		throw {
			"code" : "TIMEOUT"
		};
	}
	
	if(response.type === "error"){
		console.log("RUNTIME ERROR");
		throw {
			"code" : "RUNTIME",
			"data" : response.data
		}
	}
	
	return response.data;
};

threadify.require = function(namespaceID){
	try{
		var modulePath	= storage[namespaceID].module;
	}catch(e){
		throw {
			"code" : "UNKNOWN_NAMESPACE",
			"data"	: {
				"namespace" : namespaceID,
				"exception"	: e
			}
		}
	}
	
	try{
		var _module		= require(modulePath);
	}catch(e){
		throw {
			"code"	: "REQUIRE_MODULE_ERROR",
			"data"	: {
				"module-path"	: modulePath,
				"exception"		: e
			}
		}
	}
	
	for(var propertyName in _module){
		if(typeof _module[propertyName] === "function"){
			_module[propertyName] = (function(action){
				return function(params){
					return threadify.run({
						"namespace" : namespaceID,
						"action"	: action,
						"data"		: params
					});
				};
			})(propertyName);
		}
	}
	
	return _module;
};

function startWorker(info){
	var id		= generateUUID();
	var worker	= createWorker(info.workerType, id);
	var port	= worker.port;
	var created	= false;
	
	port.onmessage = function(message){
		var response	= message.data;
		var type		= response.type;
		var data		= response.data;

		if(type === "__info__" && data === "ready"){
			port.postMessage({
				"action" : "__init__",
				"data"	 : {
					"module" : info.module
				}
			});			
		} else {
			/*
			 * Received an error or a ready
			 */
			created = true;
			exitWait();
		}
		
	};
	
	wait(DEFAULTS.CREATION_TIMEOUT);
	
	if(!created){
		throw {
			"code" 		: "TIMEOUT",
			"message"	: "worker creation timeout"
		}
	}
	
	return id;
}

function reserveWorker(namespaceID, queue){
	
	var worker = null;
	
	try{
		storage.lock();
			
		var namespace 	= storage[namespaceID];
		var freeWorkers	= namespace.workers["free"];
		var workerInfo	= freeWorkers.pop();
		
		if(!workerInfo){
			
			console.log("No free workers available");
			
			/*if(!queue){
				throw {
					"code" : "NO_FREE_WORKER"
				}
			}
			
			console.log("Waiting for a worker to be freed");
			
			wait(100);*/
			
			return null;//reserveWorker(namespaceID, queue); //might cause stack problem
		}
		
		worker 		= createWorker(namespace.workerType, workerInfo.id);
		worker.id	= workerInfo.id;
		
		storeWorkerState(namespaceID, workerInfo.id, "busy");		
		
	}finally{
		storage.unlock();
	}
	
	return worker;
}

function releaseWorker(namespaceID, workerID){
	storeWorkerState(namespaceID, workerID, "free");
}

function createNamespace(info){
	try{
		storage.lock();
		
		var namespace 	= {};
		var namespaceID	= info.namespace;
		
		namespace.workerType	= info.workerType;
		namespace.module		= info.module;
		namespace.ID			= info.namespace;
		namespace.workers		= {};
		namespace.workers.free	= [];
		namespace.workers.busy	= [];
		
		storage[namespaceID]	= namespace;
	}finally{
		storage.unlock();
	}
}

function storeWorkerState(namespaceID, workerID, state){	
	try{		
		storage.lock();
			
		var namespace 		= storage[namespaceID];		
		var states			= ["busy", "free"];
		var currentState	= "";
		var position		= -1;
		var worker			= null;
		
		states.some(function(s){
			namespace.workers[s].some(function(w, pos){
				if(w.id === workerID){
					worker 		= w;
					position	= pos;
					
					return true;
				}
			});
			if(worker !== null){
				currentState = s;
				return true;
			}
		});
		
		if(worker){
			namespace.workers[currentState].splice(position,1);
		}
		
		namespace.workers[state].push({
			"id" : workerID
		});
		
		storage[namespaceID]	= namespace;
	}finally{
		storage.unlock();
	}	
}

function createWorker(type, id){
	var workerPath	= File( File(module.filename).parent , "./worker.js").path;
	var worker		= null;
	
	if(type==="NodeWorker"){
		worker = new NodeWorker(workerPath, id);
	} else {
		worker = new SharedWorker(workerPath, id);
	}
	
	return worker;
}