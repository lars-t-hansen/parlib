Parallel ray tracer, take 1.

Here there is a copy of the scene graph in each worker (yeah, lame, we
should fix that in the next version).  Only the frame buffer and the
coordination data are shared.

Work is scheduled by breaking the scene into pixel strips and adding
those strips to a work queue.  The master does that scheduling.

When the slaves read sentinel nodes they exit the work loop and
decrement a counter; the last one out sends a message to the master
that computation is done and the master will display the image.

On my 4x2 MacBook Pro I get decent speedup over the sequential version
with 8 workers and aliasing enabled:

With 1 worker:  78s  (sequential code is at this level too)
With 2 workers: 40s
With 4 workers: 24s
With 6 workers: 21s  (20.6)
With 8 workers: 21s  (20.9)

There should be relatively little contention, since each work item is
quite expensive, so the limitation on speedup is likely memory
bandwidth and other CPU resources.  The full grid is 1920000 bytes.
