// Multi-producer multi-consumer bounded buffer.
//
// Currently only defined for BoundedBuffer.ref.
//
// To create a BoundedBuffer.ref (in one worker):
//
//  var b = (new BoundedBuffer.ref).init(100);  // Capacity 100
//
// To add an element to b (in any worker):
//
//  b.put(x)
//
// To remove an element:
//
//  v = b.get()

const BoundedBuffer = {};

BoundedBuffer.ref =
    (function () {
	"use strict";

	// Elements are inserted at tail and extracted at head.
	// The queue is empty if tail == head.
	// The queue is full if (tail + 1) % length == head.
	//
	// To be safe for multiple producers and consumers the buffer
	// must track the number of waiters and wake waiters if there
	// are any, and not simply trigger wakeup on transitions from
	// empty to nonempty or full to nonfull.

	const BoundedBuffer =
	    SharedStruct.Type("BoundedBuffer",
			      {_items:SharedStruct.ref,
			       _waiters:SharedStruct.int32,
			       _head:SharedStruct.int32,
			       _tail:SharedStruct.int32,
			       _lock:SharedStruct.ref,
			       _cond:SharedStruct.ref});

	BoundedBuffer.prototype.init =
	    function (nelems) {
		var l = new Lock;
		this._items = new SharedArray.ref(nelems+1);
		this._lock = l;
		this._cond = new Cond({lock:l});
		return this;
	    };

	BoundedBuffer.prototype.get =
	    function () {
		var l = this._lock;
		var c = this._cond;
		var xs = this._items;
		l.lock();
		while (this._head == this._tail) {
		    this._waiters++;
		    c.wait();
		    this._waiters--;
		}
		var h = this._head;
		var x = xs.get(h);
		this._head = (h + 1) % xs.length;
		if (this._waiters)
		    c.wake();
		l.unlock();
		return x;
	    };

	BoundedBuffer.prototype.put =
	    function (v) {
		var l = this._lock;
		var c = this._cond;
		var xs = this._items;
		l.lock();
		while ((this._tail + 1) % xs.length == this._head) {
		    this._waiters++;
		    c.wait();
		    this._waiters--;
		}
		var t = this._tail;
		xs.put(t, v);
		this._tail = (t + 1) % xs.length;
		if (this._waiters)
		    c.wake();
		l.unlock();
	    };

	// This will not block in the lock or in a wait.
	BoundedBuffer.prototype.tryPut =
	    function (v) {
		var l = this._lock;
		var c = this._cond;
		var xs = this._items;
		if (!l.tryLock())
		    return false;
		if ((this._tail + 1) % xs.length == this._head) {
		    l.unlock();
		    return false;
		}
		var t = this._tail;
		xs.put(t, v);
		this._tail = (t + 1) % xs.length;
		if (this._waiters)
		    c.wake();
		l.unlock();
	    };

	return BoundedBuffer;
    })();
