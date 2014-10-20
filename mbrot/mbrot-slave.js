importScripts("../src/parlib.js");
importScripts("../src/util.js");
importScripts("mbrot-common.js");

onmessage =
    function (ev) {
	console.log("Setting up slave");
	SharedHeap.setup(ev.data, "slave");
	var coord = sharedVar0.get(Coord);
	perform(coord, "slave");
	if (coord.get_use_barrier())
	    coord.get_barrier(CyclicBarrier).await();
	else
	    coord.add_idle(1);
    }
