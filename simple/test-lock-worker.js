onmessage =
    function (ev) {
	var [sab, bufIdx, bufSize, availIdx, leftIdx, rightIdx, lockIdx, nonfullIdx, nonemptyIdx, numElem, myID] = ev.data;
	var iab = new SharedInt32Array(sab);
	var lock = new Lock(iab, lockIdx);
	var nonfull = new Cond(lock, nonfullIdx);
	var nonempty = new Cond(lock, nonemptyIdx);
	
	postMessage("ready");
	
	var produced = 0;
	while (produced < numElem) {
	    var elt = produced++*3 + myID;
	    lock.lock();
	    // Wait until there's a slot
	    while (iab[availIdx] == bufSize)
		nonfull.wait();
	    var right = iab[rightIdx];
	    iab[right] = elt;
	    iab[rightIdx] = (right+1) % bufSize;
	    // If the consumer might be waiting on a value, send a wakeup
	    if (iab[availIdx]++ == 0)
		nonempty.wake();
	    lock.unlock();
	    ++produced;
	}

	postMessage("done: " + myID);
    };
