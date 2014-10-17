// Parallel mandelbrot: Common code

load("parlib.js")

const height = 1024;
const width = 1024;

// These typedefs are common to master + slaves
const SS = SharedStruct;
const SA = SharedArray;
const Subgrid = SS.Type({top:SS.float64,
			 left:SS.float64,
			 bottom:SS.float64,
			 right:SS.float64});
const Subgrids = SA.Type(Subgrid);
const Coord = SS.Type({queue:SS.ref,          // Subgrids
		       qnext:SS.atomic_int32, // Next element to pick up in that grid
		       idle:SS.atomic_int32,  // Number of workers idle
		       mem:SS.ref});          // SharedArray.float64

function perform(coord) {
    const mem = coord.get_mem(SharedArray.float64);
    const queue = coord.get_queue(Subgrids);
    for (;;) {
	let v = coord.add_qnext(1);
	if (v >= queue.length)
	    break;
	let o = queue.get(Subgrid, v);
	mbrot(mem, o.top, o.left, o.bottom, o.right);
    }
    coord.add_idle(1);
}

function mbrot(...) {
}
