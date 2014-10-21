// Here we want to multiplex: the slaves compute new arrays of frames
// into a queue, and the master visualizes those frames as they become
// available.  For this we want a bounded queue of some sort.  The
// master should / could clamp its max animation speed.

const numWorkers = 4;

var workers = [];
for ( var i=0 ; i < numWorkers ; i++ ) {
    var w;
    workers.push(w = new Worker("mbrot-slave.js"));
    w.onmessage =
	function (ev) {
	    if (ev.data == "done") {
		console.log("DONE");
		displayIt();
	    }
	    else
		console.log("MESSAGE: " + ev.data);
	}
}

const sab = SharedHeap.allocate(height*width*4 + 32768);
SharedHeap.setup(sab, "master");

const queue = new SharedArray.int32(numSlices);
const mem = new SharedArray.int32(height*width);
const barrier = (new CyclicBarrier).init(numWorkers);
const coord = new Coord({queue: queue, mem: mem, barrier: barrier});

for ( var i=0 ; i < numSlices ; i++ )
    queue[i] = i*Math.floor(height/numSlices);

sharedVar0.put(coord);

for ( var w of workers )
    w.postMessage(sab, [sab]);

function displayIt() {
    var canvas = document.getElementById("mycanvas");
    canvas.width = width;
    canvas.height = height;
    
    var cx = canvas.getContext('2d');

    var X = 500;
    var W = 1000;
    var id  = cx.createImageData(W,1);
    for ( var y=200 ; y < 800 ; y++ ) {
	// This is gross because it knows too much about internals.  It seems clear
	// that we'd want to abstract / hide it somehow.
	var tmp = new SharedUint8Array(sab, mem._base + y*width*4 + X*4, W*4);
	id.data.set(tmp);
	cx.putImageData( id, X, y );
    }

    console.log("done ");
}

function show(m) {
    console.log(SharedHeap.pid + ": " + m);
}
