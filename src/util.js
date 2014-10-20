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

var CyclicBarrier =
    (function () {
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
		    //console.log("waking all");
		    cond.wakeAll();
		    lock.unlock();
		    return index;
		}

		this.set__index(index+1);
		var flag = this.get__seq();
		var it = 0;
		while (flag == this.get__seq()) {
		    //console.log("sleeping #" + index + " @ " + it++);
		    cond.wait();
		}
		//console.log("woken up #" + index);
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

