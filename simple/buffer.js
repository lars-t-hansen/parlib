// Simple multi-producer multi-consumer bounded buffer.
// 2015-01-13 / lhansen@mozilla.com
//
// NOTE: you must load lock.js before loading this file.

//////////////////////////////////////////////////////////////////////
//
// Bounded buffers.
//
// Bounded buffers are JS objects that use some shared memory for
// private data.  The number of shared int32 locations needed is given
// by Buffer.NUMLOCS; this is separate from data needed for buffer
// value storage.  The shared private memory for a buffer should be
// initialized once by calling Buffer.initialize() on the memory,
// before constructing the first Buffer object in any agent.
//
// Implementation note:
// The motivation for tracking the number of waiting consumers and
// producers is to avoid calling cond.wake on every insert.  It
// is possible this optimization should be moved into the condition
// variable.

// Create a Buffer object.
//
// 'iab' is a SharedInt32Array, for book-keeping data.
// 'ibase' is the first of Buffer.NUMLOCS locations in iab reserved
// for this Buffer.
// 'dab' is a SharedTypedArray, for the buffer data.
// 'dbase' is the first location in 'dab' for buffer data.
// 'dsize' is the number of locations in 'dab' for buffer data.
//
// The five parameters should be the same in all agents; though iab
// and dab will reference different objects they should reference the
// same underlying shared memory at the same buffer offsets.

function Buffer(iab, ibase, dab, dbase, dsize) {
    this.iab = iab;
    this.dab = dab;
    this.dbase = dbase;
    this.dsize = dsize;
    this.ibase = ibase;
    var  lockIdx = ibase+5;
    var  nonemptyIdx = lockIdx + Lock.NUMLOCS;
    var  nonfullIdx = nonemptyIdx + Cond.NUMLOCS;
    this.lock = new Lock(iab, lockIdx);
    this.nonempty = new Cond(lock, nonemptyIdx);
    this.nonfull = new Cond(lock, nonfullIdx);
}

Buffer.NUMLOCS = Lock.NUMLOCS + 2*Cond.NUMLOCS + 5;

// Initialize shared memory for a Buffer object.
//
// 'iab' is a SharedInt32Array, for book-keeping data.
// 'ibase' is the first of Buffer.NUMLOCS locations in iab reserved
// for this Buffer.
//
// Returns 'ibase'.
Buffer.initialize =
    function (iab, ibase) {
	iab[ibase] = 0;		// left
	iab[ibase+1] = 0;	// right
	iab[ibase+2] = 0;	// avail
	iab[ibase+3] = 0;	// producersWaiting
	iab[ibase+4] = 0;	// consumersWaiting
	var lockIdx = ibase+5;
	var nonemptyIdx = lockIdx + Lock.NUMLOCS;
	var nonfullIdx = nonemptyIdx + Cond.NUMLOCS;
	Lock.initialize(iab, lockIdx);
	Cond.initialize(iab, nonemptyIdx);
	Cond.initialize(iab, nonfullIdx);
    };

// Remove one element, wait until one is available.
Buffer.prototype.take =
    function (index) {
	const iab = this.iab;
	const leftIdx = this.ibase;
	const availIdx = leftIdx+2;
	const producersWaitingIdx = leftIdx+3;
	const consumersWaitingIdx = leftIdx+4;
	
        this.lock.lock();
        while (iab[availIdx] == 0) {
	    iab[consumersWaitingIdx]++;
            this.nonempty.wait();
	    iab[consumersWaitingIdx]--;
	}
        var left = iab[leftIdx];
        var value = this.dab[this.dbase+left];
        iab[leftIdx] = (left+1) % this.dsize;
	if (iab[producersWaitingIdx] > 0)
	    this.nonfull.wake();
        this.lock.unlock();
	return value;
    };

// Insert one element, wait until space is available.
Buffer.prototype.put =
    function (index, value) {
	const iab = this.iab;
	const ibase = this.ibase;
	const rightIdx = ibase+1;
	const availIdx = ibase+2;
	const producersWaitingIdx = ibase+3;
	const consumersWaitingIdx = ibase+4;
	const dsize = this.dsize;

        this.lock.lock();
        while (iab[availIdx] == dsize) {
	    iab[producersWaitingIdx]++;
            this.nonfull.wait();
	    iab[producersWaitingIdx]--;
	}
        var right = iab[rightIdx];
        this.dab[this.dbase+right] = value;
        iab[rightIdx] = (right+1) % dsize;
	if (iab[consumersWaitingIdx] > 0)
            this.nonempty.wake();
        this.lock.unlock();
    };

// Return the number of additional elements that can be inserted into
// the buffer before the insert will block.
Buffer.prototype.remainingCapacity =
    function () {
	const availIdx = this.ibase+2;

        this.lock.lock();
	var available = this.iab[availIdx];
	this.lock.unlock();
	return this.dsize - available;
    };

