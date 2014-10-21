
const numWorkers = 8;

var workers = [];
for ( var i=0 ; i < numWorkers ; i++ ) {
    var w;
    workers.push(w = new Worker("mbrot-slave.js"));
    w.onmessage =
	function (ev) {
	    if (ev.data == "done") {
		//console.log("DONE");
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
const endBarrier = (new CyclicBarrier).init(numWorkers);
const coord = new Coord({queue:queue,
			 qnext:0,
			 magnification:1,
			 flag:1,
			 mem:mem,
			 endBarrier:endBarrier});

for ( var i=0 ; i < numSlices ; i++ )
    queue[i] = i*Math.floor(height/numSlices);

sharedVar0.put(coord);

for ( var w of workers )
    w.postMessage(["setup", sab], [sab]);

var iterations = 0;
var maxit = 120;
var mag = 1;
setTimeout(runIt, 0);

function runIt() {
    if (++iterations > maxit) {
	var secs = Math.round(new Date() - firstFrame)/1000;
	show("Time = " + secs + "; " + maxit/secs + " fps avg");
	return;
    }
    coord.set_magnification(mag);
    coord.set_qnext(0);
    mag *= 1.1;
    for ( var w of workers )
	w.postMessage(["do"]);
}
    
var first = true;
var firstFrame;
var mycanvas;
var cx;
var id;
var tmp;

function displayIt() {
    if (first) {
	first = false;
	firstFrame = new Date();
	mycanvas = document.getElementById("mycanvas");
	cx = mycanvas.getContext('2d');
	id  = cx.createImageData(width, height);
	tmp = new SharedUint8Array(sab, mem.bytePtr(), height*width*4); 
    }
    id.data.set(tmp);
    cx.putImageData( id, 0, 0 );

    setTimeout(runIt, 0);
}

function show(m) {
    console.log(SharedHeap.pid + ": " + m);
}
