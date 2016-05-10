var actions;

onconnect = function(event){
	var port = event.ports[0];
	
	port.onmessage = function(message){
		var request 	= message.data;
		if(!request){
			console.log("This should not happen!");
			sendError(port, {
				"CODE" 		: "INTERNAL_ERROR",
				"message"	: "empty request"
			});
			return;
		}
		handleRequest(port, request);
	};
	
	port.postMessage({
		"type"		: "__info__",
		"data"		: "ready"
	});
};

function handleRequest(port, request){
	var action	= request.action;
	var data	= request.data;
	var result;

	if(action === "__init__"){
		try{			
			actions = require(data.module);
			
			if(typeof actions["__init__"] !== "undefined"){
				throw "'__init__' and '__info__' are reserved actions"
			}
			
			if(typeof actions["init"] === "undefined"){
				sendResult(port, "ready");
				
				return;
			}
			
			actions.init();
			
			sendResult(port, "ready");
		}catch(e){
			debugger;
			console.log("An error occured during the initialization of : " + data.module);
			
			sendError(port, {
				"code"	: "INIT_ERROR",
				"data"	: e
			});
		}
		
		return;
	}
	
	if(typeof actions[action] === "undefined"){
		sendError(port, {
			"code"	: "UNKNOWN_ACTION"
		});
		
		return;
	}
	
	try{		
		result = actions[action](data);
	}catch(e){
		sendError(port, {
			"code"	: "RUNTIME",
			"data"	: e
		});
	}
	
	sendResult(port, result);
}

function sendError(port, error){
	sendMessage(port, "error", error);
}

function sendResult(port, result){
	sendMessage(port, "result", result);
}

function sendMessage(port, type, data){
	port.postMessage({
		"type" : type,
		"data" : data
	});
}
