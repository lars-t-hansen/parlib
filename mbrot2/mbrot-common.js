// Parallel mandelbrot: Common code.
// Include this first in both master and slaves.

const g_center_x = -0.743643887037158704752191506114774;
const g_center_y = 0.131825904205311970493132056385139;

// Pixel grid.  (0,0) correspons to (bottom,left)
const height = 480; // Math.floor((g_top-g_bottom)*256);
const width = 640; // Math.floor((g_right-g_left)*256);

const numSlices = 100;

const SS = SharedStruct;
const Coord = SS.Type({queue:SS.ref,          // SharedInt32Array: representing the low y coordinate in the slice
		       qnext:SS.atomic_int32, // Next element to pick up in the queue
		       endBarrier:SS.ref,        // CyclicBarrier
		       magnification:SS.int32,
		       flag:SS.int32,	      // Set to 1 when we want to exit
		       mem:SS.ref});          // SharedArray.int32(height*width)

function perform(coord, who) {
    const g_magnification = coord.magnification;
    const g_top = g_center_y + 1/g_magnification;
    const g_bottom = g_center_y - 1/g_magnification;
    const g_left = g_center_x - width/height*1/g_magnification;
    const g_right = g_center_x + width/height*1/g_magnification;
    const mem = coord.mem;
    const queue = coord.queue;
    var items = 0;
    var sumit = 0;
    var slices = "";
    for (;;) {
	var v = coord.add_qnext(1);
	if (v >= queue.length)
	    break;
	//slices += v + " ";
	var ybottom = queue[v];
	var ytop = Math.min(height, Math.floor(ybottom + (height / numSlices)));
	var MAXIT = 1000;
	for ( var Py=ybottom ; Py < ytop ; Py++ ) {
	    for ( var Px=0 ; Px < width ; Px++ ) {
		var x0 = g_left+(Px/width)*(g_right-g_left);
		var y0 = g_bottom+(Py/height)*(g_top-g_bottom);
		var x = 0.0;
		var y = 0.0;
		var it = 0;
		while (x*x + y*y < 4 && it < MAXIT) {
		    var xtemp = x*x - y*y + x0;
		    y = 2*x*y + y0;
		    x = xtemp;
		    it++;
		}
		sumit += it;
		var g = 255 - (it > 255 ? 255 : it);
		mem[Py*width+Px] = (255 << 24) | (g << 8); // rgba, BUT little-endian
	    }
	}
	items++;
    }
    //show(who + " finished " + items + " items for " + sumit + " iterations: " + slices);
}
