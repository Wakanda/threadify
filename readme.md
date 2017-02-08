
# Usage

Threadify is a wakanda module that manages a pool of worker for you.

- It handles a pool of 10 (default) workers.
- It handles NodeWorkers.
- It can dedicate a worker pool to a module.
- It can execute module methods in its worker pool.

# Example

```
// PROJECT/backend/myExample.js
// Requires threadidy modules
// Defined in PROJECT/backend/modules/threadify
var threadify = require( 'threadify' );

// Requires a module to run in a NodeWorker.
// Defined in PROJECT/backend/modules/db
// @param module module path to require
// @param reserved "true" if the worker pool is dedicated to this module and must not run another module.
var db = threadify.require( 'db' );
db.helloWorld( {name: 'john'} );
```

### Sync example

```
// PROJECT/backend/modules/db/index.js
// @param params Method parameters
exports.helloWorld = function( params ){

    return "Hello " + params.name;

};
```

### Async example

```
// PROJECT/backend/modules/db/index.js
// @param params Method parameters
// @param [done] optional, returns two parameters: error, results
exports.helloWorld = function( params, done ){
    if ( params && params.name )
    {
        // Send results
        setTimeout(function(){
            done(null, "Hello " + params.name);
        }, 5000 );
    } else {
        // Send an error
        setTimeout(function(){
            var err = {code:2347, type:'exception', message:'Name parameter is missing.'}
            done(err);
        }, 5000 );
    }
};
```
