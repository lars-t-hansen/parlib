importScripts("../src/parlib.js");
importScripts("../src/CyclicBarrier.js");
importScripts("mbrot-common.js");

function show(m) {
    postMessage(SharedHeap.pid + ": " + m);
}

onmessage =
    function (ev) {
	SharedHeap.setup(ev.data, "slave");
	show("Slave online");
	var coord = sharedVar0.get();
	perform(coord, "slave");
	if (coord.use_barrier) {
	    if (coord.barrier.await() == 0)
		postMessage("done");
	}
	else
	    coord.add_idle(1);
	show("Slave quiescent");
    }
