parlib
======

Shared object heap on top of SharedArrayBuffer / SharedTypedArray.

src/ contains the core library sources, utilities, and documentation.

mbrot/ is a simple one-shot mandelbrot program demonstrating the
library use.

mbrot2/ is an animated (iterated) mandelbrot, zooming in on a point,
with work ping-ponging between the workers and the master.

mbrot3/ is an animated (iterated) mandelbrot, zooming in on a point,
with computation and display overlapping via the use of multiple
buffers and work queues.

ray/ is a sequential ray tracer.

ray2/ is a parallel ray tracer derived from the code in ray/.  Each
worker has a private copy of the scene graph.

ray3/ is a parallel ray tracer that keeps the scene graph in shared
memory.
