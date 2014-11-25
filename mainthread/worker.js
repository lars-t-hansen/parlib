importScripts("../src/parlib.js",
	      "common.js");

onmessage =
    function (ev) {
	if (Array.isArray(ev.data) && ev.data.length > 0) {
	    switch (ev.data[0]) {
	    case "start":
		runWorker(ev.data[1]);
		break;
	    default:
		postMessage(String(ev.data));
	    }
	}
	else
	    postMessage(String(ev.data));
    };

function runWorker(sab) {
    SharedHeap.setup(sab, "slave");
    var coord = sharedVar0.get();
    var lock = coord.lock;
    var cond = coord.cond;
    var buffer = coord.buffer;
    for ( var i=0 ; i < 1000 ; i++ ) {
	var v = /*fib(25)*/ 75025 * 1000 + i;
	lock.lock();
	while ((coord.tail + 1) % bufsiz == coord.head)
	    cond.wait();
	var wakeup = coord.tail == coord.head;
	buffer[coord.tail] = v;
	coord.tail = (coord.tail + 1) % bufsiz;
	if (wakeup)
	    cond.wake();
	lock.unlock();
    }
}

function fib(n) {
    if (n < 2)
	return n;
    return fib(n-1) + fib(n-2);
}
