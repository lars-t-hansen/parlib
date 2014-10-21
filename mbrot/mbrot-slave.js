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
	var coord = sharedVar0.get(Coord);
	perform(coord, "slave");
	if (coord.get_use_barrier()) {
	    if (coord.get_barrier(CyclicBarrier).await() == 0)
		postMessage("done");
	}
	else
	    coord.add_idle(1);
	show("Slave quiescent");
    }
