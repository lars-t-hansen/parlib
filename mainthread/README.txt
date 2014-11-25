An example program that blocks on the main thread.  This should not
hang, but usually it does.  The reasons why it hangs are not
understood, but small perturbations to the source seem to affect it.

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



