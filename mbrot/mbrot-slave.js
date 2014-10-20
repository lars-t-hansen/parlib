importScripts("../src/parlib.js");
importScripts("../src/util.js");
importScripts("mbrot-common.js");

onmessage =
    function (ev) {
	console.log("Setting up slave");
	SharedHeap.setup(ev.data, "slave");
	var coord = sharedVar0.get(Coord);
	perform(coord, "slave");
	coord.get_barrier(CyclicBarrier).await();
    }
