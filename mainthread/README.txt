An series of example programs that block on the main thread.

CASE 1: test1.html / {master,worker,common}1.js
-----------------------------------------------

This program maintains a bounded queue of items sent from the worker
to the master, using a shared-memory array and locks and condition
variables.  The master will block on an empty queue; the worker will
block on a full queue.  At the same time, both the worker and the
master will exit their processing loops periodically to process
events.

If the master manages to reach the blocking code before the worker
manages to start then this will lock up the browser.  The reason is
that the worker depends on the main event loop for its startup the
first place, and if the event loop can't run because the master is
blocked then the worker won't start.

(Older notes)

This should not hang, but usually it does.  The reasons why it hangs
are not understood, but small perturbations to the source seem to
affect it.

(It might be useful to have a test case for this that does not make
use of parlib, to remove other possible sources of error and
complexity.)

The scary thing is that if it's something like GC that locks the
system up (say, GC in the worker needs a lock held by the main thread,
but the main thread is blocked waiting for a result from the worker)
then we could hang also between workers if the GC requires all
runtimes to cooperate.  It would not be good to have that kind of
lock, so given how special the main thread is it may be a
main-thread-only issue.

One thing observed is that when fib(25) is the computation, things
hang, and when I substitute the value of that (in the worker), things
do not hang.  But all that says is that the worker produces a result
quickly enough?

It could of course be a bug in the lock or condition variable, or
almost anywhere.

(End older notes)




CASE 2: test2.html / {master,worker,common}2.js
-----------------------------------------------

In this case the master will not enter its work loop until it has
confirmed that the worker is running, and the worker will not exit its
processing loop until it is finished creating elements.  The worker
will place a sentinel in the buffer and the master will exit its loop
when the sentinel is seen.
