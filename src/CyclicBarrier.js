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
	    SharedStruct.Type("CyclicBarrier",
			      {_lock:    SharedStruct.ref,     // Guards the critical section
			       _cond:    SharedStruct.ref,     // Cond on _lock
			       _seq:     SharedStruct.atomic_int32,   // Next sequence number to use
			       _parties: SharedStruct.int32,   // Number of parties or -1 if reset
			       _index:   SharedStruct.int32}); // 0-based index of next waiting party

	CyclicBarrier.prototype.init =
	    function (parties) {
		var l = new Lock;
		this._lock = l;
		this._cond = new Cond({lock: l});
		this._seq = 0;
		this._parties = parties;
		this._index = 0;
		return this;
	    };

	CyclicBarrier.prototype.await =
	    function () {
		const lock = this._lock;
		const cond = this._cond;

		lock.lock();
		var index = this._index;

		if (index+1 == this._parties) {
		    this._index = 0;
		    this.add__seq(1)
		    cond.wakeAll();
		    lock.unlock();
		    return index;
		}

		this._index = index+1;
		var flag = this._seq;
		var it = 0;
		while (flag == this._seq)
		    cond.wait();
		if (this._parties <= 0)
		    index = -1;
		lock.unlock();

		return index;
	    };

	CyclicBarrier.prototype.resetAndInvalidate =
	    function () {
		this._lock.lock();
		this.add__seq(1);
		this._parties = -1;
		this._cond.wakeAll();
		this._lock.unlock();
	    };

	return CyclicBarrier;
    })();

