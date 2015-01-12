var sab = new SharedArrayBuffer(1024*1024);
SharedHeap.setup(sab, "master")

var buffer = new SharedArray.int32(bufsiz);
var lock = new Lock();
var cond = new Cond({lock:lock});
var coord = new Coord({buffer: buffer, lock: lock, cond: cond, head: 0, tail: 0});

sharedVar0.put(coord);

var worker = new Worker("worker1.js");
worker.onmessage =
    function (ev) {
	console.log(ev.data);
    };
worker.postMessage(["start", sab], [sab]);

setTimeout(masterLoop, 10);

var invocations = 0;
var seq = 0;

function masterLoop() {
    console.log("Iteration!");
    if (invocations++ >= 10)
	return;
    for ( var i=0 ; i < 100 ; i++ ) {
	lock.lock();
	while (coord.head == coord.tail) {
	    console.log("Waiting");
	    cond.wait();
	}
	console.log("Woken");
	var wakeup = (coord.tail + 1) % bufsiz == coord.head;
	var item = buffer[coord.head];
	coord.head = (coord.head + 1) % bufsiz;
	if (wakeup)
	    cond.wake();
	lock.unlock();
	var hi = Math.floor(item / 1000);
	var lo = (item % 1000);
	if (hi != 75025 || lo != seq) 
	    console.log("ERROR! " + hi + " " + lo);
	seq = lo+1;
	break;
    }
    console.log("Exiting");
    //setTimeout(masterLoop, 10);
}
