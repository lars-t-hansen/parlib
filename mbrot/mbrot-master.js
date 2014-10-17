// Also need:
//  - condition variables
//  - bounded queues?
//
// New ideas here:
//  - operations on atomic ints, here 'add'
//  - arrays of structures, not strictly necessary


//////////////////////////////////////////////////////////////////////
// Boot up (master)

const numWorkers = 3;

const sab = new SharedArrayBuffer(16*1024*1024);

const workers = [];
for ( let i=0 ; i < numWorkers ; i++ )
    workers.push(new Worker("parlib-mbrot-slave.js"));

SharedHeap.setup(sab, "master");

// TODO: fill in the queue
const queue = new Subgrids(64); // 8*8
const mem = new SA.float64(height*width);
const coord = new Coord({queue: queue, qnext: 0, idle: 0, mem: mem});

sharedVar0.put(coord);
for ( let w of workers )
    w.postMessage(sab, [sab]);

perform(coord);

// Spin - not ideal, OK for now.
while (coord.get_idle() < numWorkers)
    ;

// Done, display it?

//////////////////////////////////////////////////////////////////////
// Slave

// Types and constants are defined out here (common code)

onmessage =
    function (ev) {
	SharedHeap.setup(ev.data, "slave");
	perform(sharedVar0.get(Coord));
    }
