// A framework for master-and-slave computations where the main thread
// remains a coordinator and work is farmed out to workers.
//
// See framework-reference.txt for the full reference manual.
//
// When you use this framework DO NOT use sharedVar0, which is used by
// the framework for its own purposes.  Instead use the defineVariable
// and getVariable APIs.

// Create the Master on the main thread:
//
// new Master(memSize, numWorkers, workerURL) => <master>
//
// memSize is a number of bytes - the amount of heap the application thinks it will need
// numWorkers is a positive integer - the number of workers to create
// workerURL is a string - the program to load into each worker

function Master(memSize, numWorkers, workerURL) {
    const workers = [];

    for ( var i=0 ; i < numWorkers ; i++ ) {
	var w = new Worker(workerURL);
	w.onmessage = masterEventHandler;
	workers.push(w);
    }
    
    const sab = SharedHeap.allocate(memSize + 640*1024);
    SharedHeap.setup(sab, "master");

    const flags = new SharedInt32Array(32*numWorkers); // 128 bytes per worker

    this.flags = flags;		// Worker n uses flags[n*32], where n is pid-1
    this.barrier = new CyclicBarrier().init(numWorkers);
    this.queue = new BoundedBuffer.ref().init(numWorkers*32);
    this.workers = workers;
    this.quiescent = true;
    this.sab = sab;
    this.tasks = {tag:"tasks", ts:[]};	// Explained in the work pump, below
    this.numWorkers = numWorkers;
    this.requestSet = false;	// True if the flag requesting work item acquisition is set

    const self = this;

    function masterEventHandler(ev) {
	switch (ev.data[0]) {
	case "message":
	    // A worker sent a message for the console.
	    console.log(ev.data);
	    break;
	case "slotFree":
	    // A worker obtained a work item and observed that the master wants
	    // a notification for that.
	    self._workPump();
	    break;
	case "barrierReady":
	    // All the workers entered the common barrier.
	    var cb = self.barrierCallback;
	    var cba = self.barrierCallbackArg;
	    self.barrierCallback = null;
	    self.barrierCallbackArg = null;
	    cb(cba);
	    break;
	}
    }
}

const FLAG_DOALL = 1;		// Worker has a doAll item pending
const FLAG_BARRIER = 2;		// Worker has a barrierAll item pending
const FLAG_REPORTSLOT = 4;	// Master wants a callback when the worker takes a work item
const FLAG_EXIT = 8;		// Worker is to exit its work pump

// start() distributes the memory array to the workers and immediately
// starts them working.

const _Coord =
    new SharedStruct.Type("_Coord",
			  {barrier: SharedStruct.ref,
			   queue:   SharedStruct.ref,
			   flags:   SharedStruct.ref,
			   stride:  SharedStruct.int32});

Master.prototype.start =
    function () {
	this.quiescent = false;
	sharedVar0.put(new _Coord({barrier:this.barrier,
				   queue:  this.queue,
				   flags:  this.flags,
				   stride: 32}));
	for ( var w of this.workers )
	    w.postMessage(["start", this.sab], [this.sab]);
	this._workPump();
    };



// The appropriate API for a nonblocking master is:
//
//   - master.addWorkGenerator(generator)
//
// where generator is an ES6 generator ("function*" value) that is
// invoked to get a work item; it returns the work item or falls off
// the end, terminating the generator.  The fn may be invoked many
// times in a row; caching may be useful; note that there is however
// no guarantee about no other event handlers firing between two
// invocations.
// 
// Also:
//
//   - master.addMessageHandler(tag, fn)
//
// where fn is called back when a worker has posted a result; posting results
// in this way is optional.



// doAll() waits for the currently queued tasks to be completed, then
// fires the event with the argument on all the workers.  The workers
// do the work in parallel and independently, with no synchronization
// at the end.
// 
// doAll() is useful for (re)initialization work and other
// housekeeping that has to be done on all workers, since addTask does
// not guarantee that.
//
// doAll() will *not* release the workers if they are in a barrier.

Master.prototype.doAll =
    function (event, arg) {
	this.tasks.push({tag:"doAll", event:event, arg:arg});
	this._workPump();
    };


// barrierAll() waits for the currently queued tasks to be completed
// in the slaves, then runs callback(arg) in the master.  The slaves
// remain quiescent after entering the barrier and have to be
// restarted with master.barrierRelease().

Master.prototype.barrierAll =
    function (callback, arg) {
	this.tasks.push({tag:"barrierAll", callback:callback, arg:arg});
	this._workPump();
    };


// barrierRelease() releases workers that are stopped in a barrier;
// see barrierAll() above.  

Master.prototype.barrierRelease =
    function () {
	if (!this.quiescent)
	    throw new Error("Workers are not quiescent");
	this.quiescent = false;
	for ( var w of this.workers )
	    w.postMessage(["restart"]);
	this._workPump();
    };


// addTask(t) adds the task t to the newest task set.  The task will
// be distributed once that task set gets to the front of the queue.

Master.prototype.addTask =
    function (t) {
	var ts = this.tasks[this.tasks.length-1];
	if (ts.tag != "tasks") {
	    ts = {tag:"tasks", ts:[]};
	    this.tasks.push(ts);
	}
	ts.push(t);
	this._workPump();
    };

Master.prototype._workPump =
    function () {
	if (this.quiescent)
	    return;
    loop:
	for (;;) {
	    var ts = this.tasks[0];
	    switch (ts.tag) {
	    case "tasks":
		var t = ts.ts[0];
		ts.ts.shift(1);
		if (!t) {
		    if (this.tasks.length > 1) {
			this.tasks.shift(1);
			continue loop;
		    }
		    else if (this.requestSet) {
			this.requestSet = false;
			for ( var i=0, lim=this.numWorkers ; i < lim ; i++ )
			    Atomics.and(this.flags, this.stride*i, ~FLAG_REPORTSLOT);
		    }
		}
		else {
		    if (this.queue.tryPut(t))
			continue loop;
		    this.requestSet = true;
		    for ( var i=0, lim=this.numWorkers ; i < lim ; i++ )
			Atomics.or(this.flags, this.stride*i, FLAG_REPORTSLOT);
		    if (this.queue.tryPut(t))
			continue loop;
		    ts.ts.unshift(t);
		}
		break loop;
	    case "barrierAll":
		// Need one flag per worker.  Worker checks the flag
		// before it goes to sleep?
		//
		// Once all the workers enter the barrier, we must set this.quiescent=true
		for ( var i=0, lim=this.numWorkers ; i < lim ; i++ )
		    Atomics.or(this.flags, this.stride*i, FLAG_BARRIER);
		// Must set up the callback variables
		// Must remove the item from the queue
		// Must wake any waiting workers, but this is tricky, because it means
		//   acquiring the lock...  We can't rely on pumping in dummy items either,
		//   since the queue must be full (but then why should anyone be sleeping?)
		this._cond.wakeAll(); // Wrong
		break loop;
	    case "doAll":
		for ( var i=0, lim=this.numWorkers ; i < lim ; i++ )
		    Atomics.or(this.flags, this.stride*i, FLAG_DOALL);
		// Distribute event and arg, somehow.  There will be a queue,
		// the worker clears the FLAG_DOALL when the queue is empty
		// and is resilient to an emptyu queue with the flag set.
		break loop;
	    default:
		throw new Error("Oops");
	    }
	}
    };

// Distribute a shared variable under a key to all the workers.  (This
// is a special case of distributing an object, but it seems
// particularly useful for variables.)
//
// If the key exists then the variable is replaced.
//
// At the moment distribution is only allowed when the workers are
// quiescent, in an attempt to keep programs sane by default.

const _VarDef =
    new SharedStruct.Type("_VarDef",
			  {key: SharedStruct.ref,
			   val: SharedStruct.ref});

// Oops, doesn't work to use doAll here if the master is not running yet.
// Or at least, the run loop must be aware of that.
//
// Is doAll really what we want then?  That implies non-quiescent.

Master.prototype.defineVariable =
    function (key, value) {
	if (!this.quiescent)
	    throw new Error("Workers are not quiescent");
	this.doAll("defvar", new _VarDef({key:new SharedString(key), val: value});
    };

// new Slave(initializer) => <Slave>

function Slave(initializer) {
    onmessage = 
	function (ev) {
	    switch (ev.data[0]) {
	    case "start":	// "start" is sent by master.start()
		Parlib.setup(ev.data[1], "slave");
		if (initializer)
		    initializer();
		/*FALLTHROUGH*/
	    case "release":	// "release" is sent by master.barrierRelease();
		for (;;) {
		    // Problem is that the master cannot block!  That's going
		    // to be a problem just for getting stuff into the queue.
		    lock;
		    if (there is a work item) {
			take the work item;
		    }
		    else if (a flag is set) {
			
		    }
		    unlock;
		    // try to get a work item from the common queue
		    // if failed then get a work item from the private queue

		    switch (flag) {
		    case FLAG_BARRIER:
			this._barrier.enter();
			flag = 0;
			break;
		    case FLAG_DOALL:
			// get the info from sharedVar0, which is private to the framework(???)
			// info is event name, argument
			// TODO: race condition with multiple doAll, if not synchronized on completion,
			// could push that problem to the client...
			flag = 0;
			this._lookup(event_name)(argument);
			break;
		    case FLAG_EXIT:
			return;
		    }
		    var [name,task] = queue.get(); // Common queue, but how to signal master?
		    if (flag)			   // Only necessary if we blocked
			continue;
		    if (masterWantsToKnow)
			postMessage("morework");
		    this._lookup(name)(task);
		}
		break;
	    case "defvar":
		// define the variable
		break;
	    }
	};

    this._handlers = {};
    this._variables = {};
    this._barrier = ...;
    this._queue = ...;
}

Slave.prototype.addHandler =
    function (key, callback) {
	this._handlers[key] = callback;
    };


Slave.prototype.getVariable =
    function (key) {
	if (!this._variables.hasOwnProperty(key))
	    throw new Error("Unknown variable: " + key);
	return this._variables[key];
    };

function show(m) {
    m = SharedHeap.pid + ": " + m;
    if (SharedHeap.pid == 0)
	console.log(m);
    else
	postMessage(["message", m]);
}
