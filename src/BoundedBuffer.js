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
//  v = b.get(constructor)
//
// DESIGN NOTE: It would be possible to pass the constructor to init()
// instead.

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
	    SharedStruct.Type({_items:SharedStruct.ref,
			       _waiters:SharedStruct.int32,
			       _head:SharedStruct.int32,
			       _tail:SharedStruct.int32,
			       _lock:SharedStruct.ref,
			       _cond:SharedStruct.ref});

	BoundedBuffer.prototype.init =
	    function (nelems) {
		var l = new Lock;
		this.set__items(new SharedArray.ref(nelems+1));
		this.set__lock(l);
		this.set__cond(new Cond({lock:l}));
		return this;
	    };

	BoundedBuffer.prototype.get =
	    function (constructor) {
		var l = this.get__lock(Lock);
		var c = this.get__cond(Cond);
		var xs = this.get__items(SharedArray.ref);
		l.lock();
		while (this.get__head() == this.get__tail()) {
		    this.set__waiters(this.get__waiters()+1);
		    c.wait();
		    this.set__waiters(this.get__waiters()-1);
		}
		var h = this.get__head();
		var x = xs.get(constructor, h);
		this.set__head((h + 1) % xs.length)
		if (this.get__waiters())
		    c.wake();
		l.unlock();
		return x;
	    };

	BoundedBuffer.prototype.put =
	    function (v) {
		var l = this.get__lock(Lock);
		var c = this.get__cond(Cond);
		var xs = this.get__items(SharedArray.ref);
		l.lock();
		while ((this.get__tail() + 1) % xs.length == this.get__head()) {
		    this.set__waiters(this.get__waiters()+1);
		    c.wait();
		    this.set__waiters(this.get__waiters()-1);
		}
		var t = this.get__tail();
		xs.put(t, v);
		this.set__tail((t + 1) % xs.length);
		if (this.get__waiters())
		    c.wake();
		l.unlock();
	    };

	return BoundedBuffer;
    })();
