An series of example programs that block on the main thread.

CASE 1: test1.html / {master,worker,common}1.js
-----------------------------------------------

This program maintains a bounded queue of items sent from the worker
to the master, using a shared-memory array and locks and condition
variables from parlib.  SOP: The master will block on an empty queue,
and the worker will block on a full queue.  At the same time, both the
worker and the master will exit their processing loops periodically to
process any events that might be pending.

If the master manages to reach the blocking code before the worker
manages to start then the browser will lock up.  The reason appears to
be that the worker depends on the main event loop for its startup, and
if the event loop can't run because the master is blocked then the
worker won't start.


CASE 2: test2.html / {master,worker,common}2.js
-----------------------------------------------

The computation is pretty much the same as above, but the setup is
different:

In this case the master will not enter its work loop until it has
received confirmation that the worker is running, and the worker will
not exit its processing loop until it is finished creating elements
(ie it will not depend on events dispatched to it).

The master will still exit its loop from time to time to service
events, and will exit for good when it receives a sentinel value from
the worker, which the worker sends before leaving the production loop.

