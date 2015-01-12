// Simple, standalone lock and condition variable abstractions.
// 2015-01-12 / lhansen@mozilla.com

//////////////////////////////////////////////////////////////////////
//
// Locks.
//
// new Lock(sab, index) => lockObj
// lockObj.lock() => void
// lockObj.tryLock() => bool
// lockObj.unlock() => void
//
// 'sab' must be an Int32Array mapped onto a SharedArrayBuffer.
// 'index' must be a valid index in sab, reserved for the lock.
// sab[index] must be initialized (globally) to 0 before the first lock is created.
//
//
// Lock code taken from http://www.akkadia.org/drepper/futex.pdf
//
// 0: unlocked
// 1: locked with no waiters
// 2: locked with possible waiters

function Lock(sab, index) {
    this.sab = sab;
    this.index = index;
}

Lock.prototype.lock =
    function () {
        const sab = this.sab;
        const index = this.index;
        var c;
        if ((c = Atomics.compareExchange(sab, index, 0, 1)) != 0) {
            do {
                if (c == 2 || Atomics.compareExchange(sab, index, 1, 2) != 0)
                    Atomics.futexWait(sab, index, 2, 0);
            } while ((c = Atomics.compareExchange(sab, index, 0, 2)) != 0);
        }
    };

Lock.prototype.tryLock =
    function () {
        const sab = this.sab;
        const index = this.index;
        return Atomics.compareExchange(sab, index, 0, 1) == 0;
    };

Lock.prototype.unlock =
    function () {
        const sab = this.sab;
        const index = this.index;
        var v0 = Atomics.sub(sab, index, 1);
        // Wake up a waiter if there are any
        if (v0 != 1) {
            Atomics.store(sab, index, 0);
            Atomics.futexWake(sab, index, 1);
        }
    };

//////////////////////////////////////////////////////////////////////
//
// Condition variables.
//
// new Cond(lock, index) => condObj
// condObj.wait() => void
// condObj.wake() => void
// condObj.wakeAll() => void
// 
// 'index' must be a valid index in lock.sab, reserved for the condition.
// lock.sab[index] must be initialized (globally) to 0 before the first condition is created.
// 
// new Cond(lockObj, index) creates a condition variable that can wait on
// the lock 'lockObj', and will use lock.sab[index] for bookkeeping.
//
// condObj.wait() atomically unlocks its lock (which must be held by the
// calling thread) and waits for a wakeup on condObj.  If there were waiters
// on lock then they are woken as the lock is unlocked.
//
// condObj.wake() wakes one waiter on cond which will attempt to re-aqcuire
// the lock that it held as it waited.
//
// condObj.wakeAll() wakes all waiters on cond.  They will race to
// re-acquire the locks they held as they waited; it needn't all be
// the same locks.
//
// The caller of wake and wakeAll must hold the lock during the call.
//
// (The condvar code is based on http://locklessinc.com/articles/mutex_cv_futex,
// though modified because some optimizations in that code don't quite apply.)

function Cond(lock, index) {
    this.sab = lock.sab;
    this.seqIndex = index;
    this.lock = lock;
}

Cond.prototype.wait =
    function () {
        const seqIndex = this.seqIndex;
        const sab = this.sab;
        const seq = Atomics.load(sab, seqIndex);
        const lock = this.lock;
        lock.unlock();
        var r = Atomics.futexWait(sab, seqIndex, seq, Number.POSITIVE_INFINITY);
        lock.lock();
    };

Cond.prototype.wake =
    function () {
        const seqIndex = this.seqIndex;
        const sab = this.sab;
        Atomics.add(this.sab, seqIndex, 1);
        Atomics.futexWake(this.sab, this.seqIndex, 1);
    };

Cond.prototype.wakeAll =
    function () {
        const seqIndex = this.seqIndex;
        const sab = this.sab;
        Atomics.add(sab, seqIndex, 1);
        // Optimization opportunity: only wake one, and requeue the others
        // (in such a way as to obey the locking protocol properly).
        Atomics.futexWake(sab, seqIndex, 65535);
    };
