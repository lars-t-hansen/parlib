const numWorkers = 3;

var workers = [];
for ( var i=0 ; i < numWorkers ; i++ )
    workers.push(new Worker("mbrot-slave.js"));

const sab = SharedHeap.allocate(height*width*4 + 32768);
SharedHeap.setup(sab, "master");

const queue = new SharedArray.int32(numSlices);
const mem = new SharedArray.int32(height*width);
const coord = new Coord({queue: queue, qnext: 0, idle: 0, mem: mem});

for ( var i=0 ; i < numSlices ; i++ )
    queue[i] = i*Math.floor(height/numSlices);

sharedVar0.put(coord);

for ( var w of workers )
    w.postMessage(sab, [sab]);

setTimeout(function () { 
    perform(coord, "master");
    waitForIt();
}, 1000);

function waitForIt() {
    // The obvious spinlock does not work well.  Why is that?  On x86 this will just be
    // a regular load.  We depend on the load going to the memory system.
    // The write uses a LOCK CMPXCHG which should be enough.
    // I suppose it could be that somebody wants the spinning core to finish work.

    //var x;
    //while ((x = coord.get_idle()) < numWorkers)
    //;

    if (coord.get_idle() < numWorkers) {
	setTimeout(waitForIt, 10);
	return;
    }
    displayIt();

}


function displayIt() {
    var canvas = document.getElementById("mycanvas");
    canvas.width = width;
    canvas.height = height;
    
    var cx = canvas.getContext('2d');

    var id  = cx.createImageData(1,1);
    var pix = id.data;
    var pixs = 0;
    for ( var y=200 ; y < 800 ; y++ ) {
	for ( var x=500 ; x < 1500 ; x++ ) {
	    var v = mem[y*width+x];
	    var c = 255 - (v > 255 ? 255 : v);
	    pix[0] = 0;
	    pix[1] = c;
	    pix[2] = 0;
	    pix[3] = 255;
	    cx.putImageData( id, x, y );
	    pixs++;
	}
    }

    console.log("done " + pixs);
}
