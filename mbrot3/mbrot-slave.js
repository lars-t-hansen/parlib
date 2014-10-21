importScripts("../src/parlib.js");
importScripts("../src/util.js");
importScripts("mbrot-common.js");

function show(m) {
    postMessage(SharedHeap.pid + ": " + m);
}

onmessage =
    function (ev) {
	var d = ev.data;
	if (d[0] == "setup") {
	    SharedHeap.setup(d[1], "slave");
	    show("Slave online");
	    return;
	}
	if (d[0] == "do") {
	    var coord = sharedVar0.get(Coord);
	    var bEnd = coord.get_endBarrier(CyclicBarrier);
	    perform(coord, "slave");
	    if (bEnd.await() == 0)
		postMessage("done");
	    //show("Slave quiescent");
	    return;
	}
    };
