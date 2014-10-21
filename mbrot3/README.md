Animated mandelbrot, with overlapping display and computation.

The master has a (short) array of pending frames.  It is always
waiting for the first frame to become available, though in principle
frames may become available out of order.

The master sets up a bounded queue of tasks, each task is a slice in
some result array.  A slave picks a task off a queue and performs it.
It then decrements a count attached to the task, and if the count is
zero it sends a message to the master that some array has been
completed (thus the master need not block).
