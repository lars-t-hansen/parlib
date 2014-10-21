// Parallel mandelbrot: Common code.
// Include this first in both master and slaves.

const g_center_x = -0.743643887037158704752191506114774;
const g_center_y = 0.131825904205311970493132056385139;

// Pixel grid.  (0,0) correspons to (bottom,left)
const height = 480;
const width = 640;

const numSlices = 100;

const SS = SharedStruct;
const Task = SS.Type({mem:SS.ref,             // SharedArray.int32
		      count:SS.ref,           // SharedVar.int32
		      magnification:SS.float64,
		      ybottom:SS.int32});

function perform(queue, ready) {
    for (;;) {
	var t = queue.get(Task);
	const g_magnification = t.get_magnification();
	if (g_magnification == 0.0)
	    break;
	const g_top = g_center_y + 1/g_magnification;
	const g_bottom = g_center_y - 1/g_magnification;
	const g_left = g_center_x - width/height*1/g_magnification;
	const g_right = g_center_x + width/height*1/g_magnification;
	const mem = t.get_mem(SharedArray.int32);

	var ybottom = t.get_ybottom();
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
		var g = 255 - (it > 255 ? 255 : it);
		mem[Py*width+Px] = (255 << 24) | (g << 8); // rgba, BUT little-endian
	    }
	}
	if (t.get_count(SharedVar.int32).add(-1) == 1)
	    ready();
    }
}
