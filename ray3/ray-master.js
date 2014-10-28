const numWorkers = this.RAY_SHELL ? 0 : 6;
const numSlices = 100;
const workers = [];
const sab = SharedHeap.allocate(height*width*4 + 32768);

for ( var i=0 ; i < numWorkers ; i++ ) {
    var w = new Worker("ray-slave.js");
    w.onmessage = 
	function (ev) {
	    if (ev.data == "done")
		displayIt();
	    else
		console.log("MESSAGE: " + ev.data);
	};
    workers.push(w);
}

SharedHeap.setup(sab, "master");

const queue = (new BoundedBuffer.ref).init(numSlices + Math.max(1,numWorkers));
const mem = new SharedArray.int32(height*width);
const count = new SharedVar.int32; // TODO: clearly would be nice to have an init() here
const coord = new Coord({queue:queue, world:setStage(), mem:mem, count:count});

count.put(Math.max(1,numWorkers));

var initcolor = DL3(152.0/256.0, 251.0/256.0, 152.0/256.0)
var initc = (255<<24)|((255*initcolor.z)<<16)|((255*initcolor.y)<<8)|(255*initcolor.x)
for ( var i=0, l=width*height ; i < l ; i++ )
    mem[i] = initc;

var sliceHeight = Math.floor(height/numSlices);
for ( var i=0 ; i < numSlices-1 ; i++ )
    queue.put(new Task({bottom: i*sliceHeight, height:sliceHeight}));
var b = sliceHeight*(numSlices-1);
if (b < height)
    queue.put(new Task({bottom: b, height:height-b}));

for ( var i=0 ; i < Math.max(1,numWorkers) ; i++ )
    queue.put(new Task({bottom:0, height:0}));

sharedVar0.put(coord);
for ( var w of workers )
    w.postMessage(sab, [sab]);

var then = Date.now();

if (numWorkers == 0) {
    raytrace(coord, function () {});
    displayIt();
}

function displayIt() {
    show("Render time=" + (Date.now() - then)/1000 + "s");

    if (this.document) {
	var mycanvas = document.getElementById("mycanvas");
	var cx = mycanvas.getContext('2d');
	var id  = cx.createImageData(width, height);
	id.data.set(new SharedUint8Array(sab, mem.bytePtr(), height*width*4));
	cx.putImageData( id, 0, 0 );
    }

    show("Display done");
    return 0;
}

function show(msg) {
    if (this.console)
	console.log(msg);
    else
	print(msg);
}
