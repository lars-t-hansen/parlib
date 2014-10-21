importScripts("../src/parlib.js");
importScripts("../src/util.js");
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
	if (coord.get_barrier(CyclicBarrier).await() == 0)
	    postMessage("done");
	show("Slave quiescent");
    }
