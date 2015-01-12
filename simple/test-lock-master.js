// Create three workers that share a single-consumer multiple-producer
// bounded buffer with the master.
//
// The workers will each insert 100 elements with values ID+(n*3) into
// the buffer and then quit.

var bufIdx = 0;			// Start of buffer
var bufSize = 10;		// Number of elements in buffer
var availIdx = bufIdx+bufSize;	// Number of available values
var leftIdx = availIdx+1;	// Left end of queue (extract)
var rightIdx = leftIdx+1;	// Right end of queue (insert)
var lockIdx = rightIdx+1;	// Lock data
var nonfullIdx = lockIdx+1;	// 'Nonfull' cond data
var nonemptyIdx = nonfullIdx+1;	// 'Nonempty' cond data
var iabSize = nonemptyIdx+1;
var iab = new SharedInt32Array(iabSize);
var workers = [];
var numWorkers = 3;
var numElem = 100;		// Number of elements to produce, per worker
var check = new Int32Array(numWorkers*numElem);
var lock;
var nonfull;
var nonempty;

function runTest() {
    for ( var i=0 ; i < numWorkers ; i++ ) {
	var w = new Worker("test-lock-worker.js");
	w.onmessage =
	    function (ev) {
		if (ev.data === "ready") {
		    ++readies;
		    if (readies == numWorkers)
			consumer();
		}
		else
		    console.log(String(ev.data));
	    };
	workers.push(w);
	w.postMessage([iab.buffer, bufIdx, bufSize, availIdx, leftIdx, rightIdx, lockIdx, nonfullIdx, nonemptyIdx, numElem, i],
		      [iab.buffer]);
    }
    lock = new Lock(iab, lockIdx);
    nonfull = new Cond(lock, nonfullIdx);
    nonempty = new Cond(lock, nonemptyIdx);
}

function consumer() {
    var consumed = 0;
    while (consumed < numWorkers*numElem) {
	lock.lock();
	// Wait until there's a value
	while (iab[availIdx] == 0)
	    nonempty.wait();
	var left = iab[leftIdx];
	var elt = iab[left];
	iab[leftIdx] = (left+1) % bufSize;
	check[elt]++;
	// If a producer might be waiting on a slot, send a wakeup
	if (bufSize-(--iab[availIdx]) <= numWorkers)
	    nonfull.wake();
	lock.unlock();
	++consumed;
    }
    for ( var i=0 ; i < numWorkers*numElem ; i++ )
	if (check[i] != 1)
	    console.log("Failed at element " + i + ": " + check[i]);
}
