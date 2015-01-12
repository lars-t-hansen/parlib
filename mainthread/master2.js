var sab = new SharedArrayBuffer(1024*1024);
SharedHeap.setup(sab, "master")

var buffer = new SharedArray.int32(bufsiz);
var lock = new Lock();
var cond = new Cond({lock:lock});
var coord = new Coord({buffer: buffer, lock: lock, cond: cond, head: 0, tail: 0, rdy: 0});

sharedVar0.put(coord);

var worker = new Worker("worker2.js");
worker.onmessage =
    function (ev) {
	console.log(ev.data);
    };
worker.postMessage(["start", sab], [sab]);

setTimeout(masterLoop, 10);

var invocations = 0;
var seq = 0;
var failures = 0;

function masterLoop() {
    if (!coord.rdy) {
	if (failures++ > 10) {
	    console.log("Aborting");
	    return;
	}
	setTimeout(masterLoop, 10);
	return;
    }
    // Here we should vary the iteration count and the delay to induce waiting both here
    // and in the worker: here if the iteration count is high, in the worker if the wait is long.
    var waits = 0;
    for ( var i=0 ; i < 51 ; i++ ) {
	lock.lock();
	while (coord.head == coord.tail) {
	    ++waits;
	    cond.wait();
	}
	var wasFull = (coord.tail + 1) % bufsiz == coord.head;
	var item = buffer[coord.head];
	coord.head = (coord.head + 1) % bufsiz;
	if (wasFull)
	    cond.wake();
	lock.unlock();
	if (item == -1) {
	    console.log("Main done");
	    return;
	}
	var hi = Math.floor(item / 1000);
	var lo = (item % 1000);
	if (hi != 75025 || lo != seq) 
	    console.log("ERROR! " + hi + " " + lo);
	seq = lo+1;
    }
    console.log("Main pausing, waits=" + waits);
    setTimeout(masterLoop, 10);
}
