const numWorkers = 8;		// Number of slaves
const numImages = 3;		// Number of in-flight images

var ready = 0;			// Number of images that are complete but not displayed

var workers = [];
for ( var i=0 ; i < numWorkers ; i++ ) {
    var w;
    workers.push(w = new Worker("mbrot-slave.js"));
    w.onmessage =
	function (ev) {
	    if (ev.data == "done") {
		//console.log("DONE");
		ready++;
		displayIt();
	    }
	    else
		console.log("MESSAGE: " + ev.data);
	}
}

// In order images.  Each is an object with a mem and count field, where the mem
// is a shared array and the count is a shared var.  If the var is zero then the
// image is ready to go.

const images = [];

const sab = SharedHeap.allocate(height*width*4*numImages + 32768 + 1*1024*1024); // Hacky
SharedHeap.setup(sab, "master");

const queue = (new BoundedBuffer.ref).init(numImages*numSlices);

var iterations = 0;
var maxit = 120;
var mag = 1;

sharedVar0.put(queue);

for ( var w of workers )
    w.postMessage(sab, [sab]);

for ( var i=0 ; i < numImages ; i++ )
    pump(new SharedArray.int32(height*width), new SharedVar.int32);

function pump(mem, count) {
    count.put(numSlices);
    images.push({mem:mem, count:count});
    for ( var i=0 ; i < numSlices ; i++ )
	queue.put(new Task({mem:mem, count:count, magnification:mag, ybottom:i*Math.floor(height/numSlices)}));
    mag *= 1.1;
}

var first = true;
var firstFrame;
var mycanvas;
var cx;
var id;
var completed;
var timeoutPending;

function displayIt() {
    // This may be called without the first image in the line being done,
    // in which case we should just return after pumping in some
    // more data.  (A later image might have been finished.)  But we can't
    // allocate memory for that.
    if (images[0].count.get() > 0)
	return;

    var img = images.shift();
    ready--;

    if (first) {
	first = false;
	firstFrame = new Date();
	mycanvas = document.getElementById("mycanvas");
	cx = mycanvas.getContext('2d');
	id  = cx.createImageData(width, height);
    }
    // We could cache the temp array but it's small potatoes, and it's GC'd.
    id.data.set(new SharedUint8Array(sab, img.mem.bytePtr(), height*width*4));
    cx.putImageData( id, 0, 0 );

    if (++iterations > maxit && !completed) {
	completed = true;
	var secs = Math.round(new Date() - firstFrame)/1000;
	show("Time = " + secs + "; " + maxit/secs + " fps avg");
	// Shut down the workers
	for ( var i=0 ; i < numWorkers ; i++ )
	    queue.put(new Task({mem:null, count:null, magnification:0.0, ybottom:0}));
	return;
    }
    else
	pump(img.mem, img.count);

    if (ready && !timeoutPending) {
	timeoutPending = true;
	setTimeout(() => { timeoutPending = false; displayIt() }, 10);
    }
}

function show(m) {
    console.log(SharedHeap.pid + ": " + m);
}
