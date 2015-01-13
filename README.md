parlib
======

This repo provides two different libraries for use with SharedArrayBuffer and SharedTypedArray.

* In simple/ there are very simple control abstractions (Lock, Cond, Barrier, eventually others) that assume only minimal things about the client code but provide very little help with data abstraction.
* In src/ there is an elaborate shared-object-heap abstraction with data abstraction facilities and many utilities.  This is experimental but somewhat stable.

There are many demos here that use the shared-object-heap library:

* mbrot/ is a simple one-shot mandelbrot program demonstrating the library use.
* mbrot2/ is an animated (iterated) mandelbrot, zooming in on a point, with work ping-ponging between the workers and the master.
* mbrot3/ is an animated (iterated) mandelbrot, zooming in on a point, with computation and display overlapping via the use of multiple buffers and work queues.
* ray/ is a sequential ray tracer.
* ray2/ is a parallel ray tracer derived from the code in ray/.  Each worker has a private copy of the scene graph.
* ray3/ is a parallel ray tracer that keeps the scene graph in shared memory.
