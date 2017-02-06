var actions;
var MAX_ACTION_WAIT = 20000;

onconnect = function(event){
	var port = event.ports[0];
	
	port.onmessage = function(message){
		var request 	= message.data;
		if(!request){
			console.log('This should not happen!');
			sendError(port, {
				'CODE' 		: 'INTERNAL_ERROR',
				'message'	: 'empty request'
			});
			return;
		}
		handleRequest(port, request);
	};
	
	port.postMessage({
		'type'		: '__info__',
		'data'		: 'ready'
	});
};

function handleRequest(port, request){	
	var action	 = request.action;
	var data	 = request.data;
	var reserved = request.reserved;
	var _actions = actions;
	var result;

	if(reserved && action === '__init__'){
		try{			
			actions = require(data.modulePath);
			
			if(typeof actions['__init__'] !== 'undefined'){
				throw '"__init__" and "__info__" are reserved actions';
			}
			
			if(typeof actions['init'] === 'undefined'){
				sendResult(port, 'ready');
				
				return;
			}
			
			if(actions.init.length >= 1){
				actions.init(function(){
					exitWait();
				});
				wait(MAX_ACTION_WAIT);
			} else {
				actions.init();
			}
			
			sendResult(port, 'ready');
		}catch(e){
			console.log('An error occured during the initialization of : ' + data.module);
			
			sendError(port, {
				'code'	: 'RESERVED_MODULE_INIT_ERROR',
				'data'	: e
			});
		}
		
		return;
	}
	
	if(!reserved){
		try{
			_actions = require(request.modulePath);
		}catch(e){
			console.log('couldn\'t require the module [' + data.module + ']');
			
			sendError(port, {
				'code'	: 'MODULE_REQUIRE_ERROR',
				'data'	: e
			});
		}
		
		if(_actions && _actions.init && typeof(_actions.__init__ ) === "undefined"){
			try{
				if(_actions.init.length >= 1){
					_actions.init(function(){
						exitWait();
					});
					wait(MAX_ACTION_WAIT);
				} else {
					_actions.init();
				}
				
				_actions.__init__ = true;
			}catch(e){
				console.log('An error occured during the initialization of : ' + data.module);
				
				sendError(port, {
					'code'	: 'UNRESERVED_MODULE_INIT_ERROR',
					'data'	: e
				});
			}
		}
	}
	
	if(typeof _actions[action] === 'undefined'){
		sendError(port, {
			'code'	: 'UNKNOWN_ACTION',
			'data'  : {
				'modulePath' : data.modulePath,
				'action'     : action
			}
		});
		
		return;
	}
	
	try{
		if(_actions[action].length >= 2){
			_actions[action](data, function(_result){
				result = _result;
				exitWait();
			});
			wait(MAX_ACTION_WAIT);

		} else {
			result = _actions[action](data);
		}
	}catch(e){
		sendError(port, {
			'code'	: 'RUNTIME',
			'data'	: e
		});
	}
	
	sendResult(port, result);
}

function sendError(port, error){
	sendMessage(port, 'exception', error);
}

function sendResult(port, result){
	sendMessage(port, 'result', result);
}

function sendMessage(port, kind, data){
	port.postMessage({
		'kind' : kind,
		'type' : getTypeOfData(data),
		'data' : data
	});
}

function getTypeOfData(data){
	return typeof(data);
}
