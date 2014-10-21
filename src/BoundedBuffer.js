// To create a bounded buffer of refs (in one worker):
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
// DESIGN NOTE: It would be possible to pass the constructor to init() instead.

const BoundedBuffer = {};

BoundedBuffer.ref =
    (function () {
	"use strict";

	// Elements are inserted at tail and extracted at head.
	// The queue is empty if tail == head.
	// The queue is full if (tail + 1) % length == head.

	const BoundedBuffer =
	    SharedStruct.Type({_items:SharedStruct.ref,
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
		this.set__head(0);
		this.set__tail(0);
		return this;
	    };

	BoundedBuffer.prototype.get =
	    function (constructor) {
		var l = this.get__lock(Lock);
		var c = this.get__cond(Cond); // Optimize: reify only when needed
		var xs = this.get__items(SharedArray.ref);
		l.lock();
		while (this.get__head() == this.get__tail())
		    c.wait();
		var h = this.get__head();
		var x = constructor.fromRef(xs[h]); // Ouch, breaks abstraction?
		var wasfull = (this.get__tail() + 1) % xs.length == h;
		this.set__head((h + 1) % xs.length)
		if (wasfull)
		    c.wake();
		l.unlock();
		return x;
	    };

	BoundedBuffer.prototype.put =
	    function (v) {
		var l = this.get__lock(Lock);
		var c = this.get__cond(Cond); // Optimize: reify only when needed
		var xs = this.get__items(SharedArray.ref);
		l.lock();
		while ((this.get__tail() + 1) % xs.length == this.get__head())
		    c.wait();
		var t = this.get__tail();
		xs[t] = v._base; // Ouch, breaks abstraction?
		var wasempty = (t == this.get__head());
		this.set__tail((t + 1) % xs.length);
		if (wasempty)
		    c.wakeAll();
		l.unlock();
	    };

	return BoundedBuffer;
    })();
