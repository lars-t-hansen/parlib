Parallel mandelbrot set computation, iterated / zooming, using a
single shared buffer and a barrier between iterations.  The main
thread and the workers proceed in lockstep: the workers compute, then
the main thread displays, etc.

CPU utilization is maybe 80% with this (eyeballing the perf meter),
likely because of the frequent sequential sections.
