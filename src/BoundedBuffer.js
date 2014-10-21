var BoundedBuffer =
    (function () {
	"use strict";

	// Elements are inserted at head and extracted at tail.
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
		this.set__items(new SharedArray.ref(nelems));
		this.set__lock(new Lock);
		this.set__head(0);
		this.set__tail(0);
	    };

	BoundedBuffer.prototype.get =
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

	BoundedBuffer.prototype.put =
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
