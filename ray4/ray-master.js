var master =
    new Master(height*width*4 + 32768, // Lame to pre-size the heap but it works
	       6,		       // Lame to know the number of workers here
	       "ray-slave.js");

const mem =
    (function () {
	const mem = new SharedArray.int32(height*width);
	const initc = (255<<24)|((255*initcolor.z)<<16)|((255*initcolor.y)<<8)|(255*initcolor.x)
	for ( var i=0 ; i < width*height ; i++ )
	    mem[i] = initc;
	return mem;
    })();

const coord = (new SharedVar.ref).init(new Coord({world:setStage(), mem:mem}));
master.defineVariable("coord", coord);

const numSlices = 100;
const sliceHeight = Math.floor(height/numSlices);

function WorkItemAll(tag) {
}

function WorkItem(tag, value) {
}

function WorkItemBarrierAll(tag, callback) {
}

// There can be several of these, to produce various kinds of work items.
//
// Results are not tied to the work items, but posted separately.

master.addWorkGenerator(
    function *() {
	yield new WorkItemAll("rayinit");
	for ( var i=0 ; i < numSlices-1 ; i++ )
	    yield new WorkItem("raytrace", new Task({bottom: (i-1)*sliceHeight, height:sliceHeight}));
	const b=sliceHeight*(numSlices-1);
	if (b < height)
	    yield new WorkItem("raytrace", new Task({bottom: b, height:height-b}));
	yield new WorkItemBarrierAll("ray-barrier", displayIt);
    });

// Implementation: start() will run the pump until the queue is full, then
// start depending on callbacks from the slaves about completed work.
// Or there could be a shared atomic counter and a setTimeout thing.

master.start();

/*
master.doAll("rayinit", null);

for ( var i=0 ; i < numSlices-1 ; i++ )
    master.addWork("raytrace", new Task({bottom: i*sliceHeight, height:sliceHeight}));
const b = sliceHeight*(numSlices-1);
if (b < height)
    master.addWork("raytrace", new Task({bottom: b, height:height-b}));

master.barrierAll(displayIt, null);
*/

var then = Date.now();

function displayIt() {
    show("Render time=" + (Date.now() - then)/1000 + "s");

    var mycanvas = document.getElementById("mycanvas");
    var cx = mycanvas.getContext('2d');
    var id  = cx.createImageData(width, height);
    id.data.set(new Uint8Array(sab, mem.bytePtr(), height*width*4));
    cx.putImageData( id, 0, 0 );

    return 0;
}
