
# Usage

Threadify is a wakanda module that manages a pool of worker for you.

- It handles a pool of 10 (default) workers. Can be changed.
- It handles NodeWorkers (default) or Shared worker.
- It can execute module methods in its worker pool.

# Example

```
// PROJECT/backend/myExample.js
// Requires threadidy modules
// Defined in PROJECT/backend/modules/threadify
var threadify = require( 'threadify' );

// Requires a module to run in a NodeWorker.
// Defined in PROJECT/backend/modules/db
var db = threadify.require( 'db' );
db.helloWorld( {name: 'john'} );
```

### Sync example

```
// PROJECT/backend/modules/db/index.js
// @param params Method parameters
exports.helloWorld = function( params ){

    return "Hello " + params.name;
    // Hello john

};
```

### Async example

```
// PROJECT/backend/modules/db/index.js
// @param params Method parameters
// @param [done] optional, to use with callback + return value
exports.helloWorld = function( params, done ){
    setTimeout(function(){
        done("Hello " + params.name)
    }, 5000 );
};
```
