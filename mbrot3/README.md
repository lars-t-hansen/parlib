Iterated parallel mandelbrot set computation, with overlapping display
and computation.

The master has a (short) array of pending frames.  It is always
waiting for the first frame to become available, though in principle
frames may become available out of order.

The master sets up a bounded queue of tasks, each task is a slice in
some result array.  A slave picks a task off a queue and performs it.
It then decrements a count attached to the task, and if the count is
zero it sends a message to the master that some array has been
completed (thus the master need not block).  The master responds to
this by trying to display the first pending frame, and if that's
successful it adds more work items to the queue.

On my 4x2 MBP this takes us from 13.3fps to 15.7fps (18% improvement)
with 3 in-flight frames, and CPU utilization during most of the run is
100% (it drops off near the end, which it also does with 8 in-flight
frames).
