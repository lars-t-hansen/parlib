importScripts("../src/parlib.js");
importScripts("../src/BoundedBuffer.js");
importScripts("mbrot-common.js");

function show(m) {
    postMessage(SharedHeap.pid + ": " + m);
}

onmessage =
    function (ev) {
	SharedHeap.setup(ev.data, "slave");
	show("Slave online");
	perform(sharedVar0.get(BoundedBuffer.ref), function () { postMessage("done"); });
	show("Slave quiescent");
    };
