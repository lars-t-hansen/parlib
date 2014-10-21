// Miscellaneous types for parlib programs.

//////////////////////////////////////////////////////////////////////
//
// CyclicBarrier a la Java.
//
// To create a barrier (in one worker):
//
//   var b = (new CyclicBarrier).init(4);  // 4 parties can wait
//
// To enter the barrier (in any worker):
//
//   b.await() // returns the arrival index or -1 if the barrier was reset
//
// Once the last party awaits the waiters are all released, and the barrier
// can be reused immediately without other action.
//
// To reset and kill the barrier (in any worker) and make all waiters return:
//
//   b.resetAndInvalidate()

// Note, Depper (see ref on Lock implementation) has a simpler
// implementation of a barrier that does not need a condition
// variable; but it goes straight to futexes and is thus low-level.

var CyclicBarrier =
    (function () {
	"use strict";

	const CyclicBarrier =
	    SharedStruct.Type({_lock:    SharedStruct.ref,     // Guards the critical section
			       _cond:    SharedStruct.ref,     // Cond on _lock
			       _seq:     SharedStruct.atomic_int32,   // Next sequence number to use
			       _parties: SharedStruct.int32,   // Number of parties or -1 if reset
			       _index:   SharedStruct.int32}); // 0-based index of next waiting party

	CyclicBarrier.prototype.init =
	    function (parties) {
		var l = new Lock;
		this.set__lock(l);
		this.set__cond(new Cond({lock: l}));
		this.set__seq(0);
		this.set__parties(parties);
		this.set__index(0);
		return this;
	    };

	CyclicBarrier.prototype.await =
	    function () {
		const lock = this.get__lock(Lock);
		const cond = this.get__cond(Cond);

		lock.lock();
		var index = this.get__index();

		if (index+1 == this.get__parties()) {
		    this.set__index(0);
		    this.add__seq(1)
		    cond.wakeAll();
		    lock.unlock();
		    return index;
		}

		this.set__index(index+1);
		var flag = this.get__seq();
		var it = 0;
		while (flag == this.get__seq())
		    cond.wait();
		if (this.get__parties() <= 0)
		    index = -1;
		lock.unlock();

		return index;
	    };

	CyclicBarrier.prototype.resetAndInvalidate =
	    function () {
		this.get__lock(Lock).lock();
		this.add__seq(1);
		this.set__parties(-1);
		this.get__cond(Cond).wakeAll();
		this.get__lock(Lock).unlock();
	    };

	return CyclicBarrier;
    })();

var BoundedQueue =
    (function () {
	"use strict";

	// Elements are inserted at head and extracted at tail.
	// The queue is empty if tail == head.
	// The queue is full if (tail + 1) % length == head.

	const BoundedQueue =
	    SharedStruct.Type({_items:SharedStruct.ref,
			       _head:SharedStruct.int32,
			       _tail:SharedStruct.int32,
			       _lock:SharedStruct.ref,
			       _cond:SharedStruct.ref});

	BoundedQueue.prototype.init =
	    function (nelems) {
		this.set__items(new SharedArray.ref(nelems));
		this.set__lock(new Lock);
		this.set__head(0);
		this.set__tail(0);
	    };

	BoundedQueue.prototype.get =
	    function (constructor) {
		var l = this.get__lock(Lock);
		var c = this.get__cond(Cond); // Optimize: reify only when needed
		var xs = this.get__items(SharedArray.ref);
		l.lock();
		var t;
		while (this.get__head() == (t = this.get__tail()))
		    c.wait();
		var x = constructor.fromRef(xs[t]);
		this.set__tail((t+1) % xs.length)
		// now if it was full wake up any putter
		l.unlock();
		return x;
	    };

	BoundedQueue.prototype.put =
	    function (v) {
		var l = this.get__lock(Lock);
		var c = this.get__cond(Cond); // Optimize: reify only when needed
		var xs = this.get__items(SharedArray.ref);
		l.lock();
		// wait for space
		while (this.get__head() == (this.get__tail() + 1) % xs.length)
		    c.wait();
		// put element
		// now wake up any waiting getter
		l.unlock();
	    };
    })();
