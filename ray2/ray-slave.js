importScripts("../src/parlib.js");
importScripts("../src/BoundedBuffer.js");
importScripts("ray-common.js");

function show(m) {
    postMessage(SharedHeap.pid + ": " + m);
}

onmessage =
    function (ev) {
	SharedHeap.setup(ev.data, "slave");
	show("Slave online");
	raytrace(sharedVar0.get(Coord), function () { postMessage("done"); });
	show("Slave quiescent");
    };
