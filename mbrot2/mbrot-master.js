// To do:
//  - Figure out why the spinlock does not work well
//  - Worry about worker priority in RuntimeServices.cpp

const workOnMain = false;
const numWorkers = 3 + (workOnMain ? 0 : 1);

var workers = [];
for ( var i=0 ; i < numWorkers ; i++ ) {
    var w;
    workers.push(w = new Worker("mbrot-slave.js"));
    w.onmessage =
	function (ev) {
	    if (ev.data == "done") {
		console.log("DONE");
		if (!workOnMain)
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
const barrier = (new CyclicBarrier).init(numWorkers + (workOnMain ? 1 : 0));
const coord = new Coord({queue: queue, use_barrier: 1, mem: mem, barrier: barrier});

for ( var i=0 ; i < numSlices ; i++ )
    queue[i] = i*Math.floor(height/numSlices);

sharedVar0.put(coord);

for ( var w of workers )
    w.postMessage(sab, [sab]);

if (workOnMain) {
    setTimeout(function () { 
	perform(coord, "master");
	waitForIt();
    }, 750);			// The 750 is to give the slaves a chance to do something
}

var startWait;

function waitForIt() {
    if (!startWait)
	startWait = new Date();

    if (coord.get_use_barrier())
	coord.get_barrier(CyclicBarrier).await();

    // The obvious spinlock does not work well.  Why is that?  On x86 this will just be
    // a regular load.  We depend on the load going to the memory system.
    // The write uses a LOCK CMPXCHG which should be enough.
    // I suppose it could be that somebody needs the spinning core for finishing work,
    // but it's not obvious.

    // Nor does a CAS spinlock work any better than one that simply loads:
    //while (coord.compareExchange_idle(3,0) != 3)
    //    ;

    if (!coord.get_use_barrier()) {
	if (coord.get_idle() < numWorkers) {
	    setTimeout(waitForIt, 10);
	    return;
	}
    }

    endWait = new Date();
    console.log(endWait - startWait);
    displayIt();
}

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
