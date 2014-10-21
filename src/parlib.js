/*
 * Utilities for plain js to use shared memory (relatively)
 * conveniently.
 *
 * DRAFT.
 * 21 October 2014 / lhansen@mozilla.com.
 *
 * For documentation and examples see parlib.txt.
 */

/*
 * TODO:
 *  - Getters and setters instead of set_ and get_ functions.
 *
 *  - Structural equivalence for type reconstruction is really not
 *    a great idea, even if it's safe.  We may want to introduce
 *    some notion of a brand, at a minimum.
 *
 *  - Storage management.
 *
 *  - More atomic operations (sub on int/float; and, or, xor on int)
 *
 *  - Locks and condition vars can probably be faster.
 */

/* Implementation details.
 *
 * Object protocols.
 *
 * Every implementation of a 'struct' or 'array' type must conform to
 * the following:
 *
 *  - the type's constructor must have these properties:
 *    - _desc
 *      The type's descriptor bits (int32 for now, see below).
 *
 *    - fromRef(r)
 *      Creates a new front object with the given shared memory
 *      address r, initializes the object but not the shared memory.
 *      Not transferable.
 *
 *  - the instance must have these properties:
 *    - _base
 *      The shared-memory address (within _iab)
 *  
 * 
 * Shared memory object layout.
 *
 * Each object maps to an even number of words in the integer mapping
 * of the heap memory ("_iab" in the following).  The low bit of
 * an object address is zero.
 *
 * The first word of an object is a descriptor with the following
 * fields:
 *
 *   +-+---+------------------------+----+
 *   |0| B | F                      | C  |
 *   +-+---+------------------------+----+
 *
 * 0 is always zero (making the descriptor a nonnegative int32 value)
 *
 * B are three tag bits:
 *   000  plain-ish object
 *   001  array
 *   xxx  others unallocated
 *
 * If B=000 then the value is a "structure" type:
 *
 *   C is a word count (four bits, max 12 words).
 * 
 *   F is a bit vector of field descriptors, two bits per word in the
 *   object:
 *
 *      00   padding / unused
 *      01   ref
 *      10   float64 (either word)
 *      11   int32
 *
 *   F is filled from the lower-order bits toward higher-order.  The
 *   object is allocated on an even-numbered word boundary.  Float64
 *   data are allocated on an even-numbered word boundary too.
 *
 *   Unused high bits in F must be filled with zeroes.
 *
 * If B=001 then the value is an "array" type:
 *
 *   C must be 0
 *
 *   F must contain a single two-bit field signifying the type value,
 *   as above.
 *
 *   The word after the header contains the byte count of the array
 *   payload.
 *
 *   The payload begins on the word after that (8-byte aligned), and
 *   the SharedTArray's bufferOffset will reflect that.
 *
 * This layout is naive, it does not allow structures of arrays or
 * arrays of structures.
 *
 * 
 * Shared heap layout.
 *
 * There is one global SharedArrayBuffer, available through global
 * '_sab'.  We map SharedTypedArrays onto this for administration
 * purposes, these are available through '_iab' (int32) and '_dab'
 * (float64).  All units of allocation are in words of '_iab', all
 * addresses are indices in '_iab'.
 *
 * The low words of '_iab' are allocated as follows:
 *
 *   0: unused, the "null ref" points here
 *   1: iab next-free pointer (variable, update with CAS)
 *   2: iab limit pointer (constant, pointer past the end)
 *   3: next process ID
 *   4: sharedVar0: starts here
 *   5: ...
 *   
 * The next-free pointer should be kept 8-byte aligned (2 words).
 */

const _ref = 1;         // Descriptor for a shared object reference field
const _f64 = 2;         // Descriptor for a double field
const _i32 = 3;         // Descriptor for an int32 field

const _array_int32_desc = (1 << 28) | (_i32 << 4);
const _array_float64_desc = (1 << 28) | (_f64 << 4);
const _array_ref_desc = (1 << 28) | (_ref << 4);

const _var_int32_desc = (_i32 << 4) | 1;                               // One word: the value
const _var_float64_desc = (_f64 << 8) | (_f64 << 6) | (_i32 << 4) | 3; // Three words: spinlock, then an aligned double
const _var_ref_desc = (_ref << 4) | 1;                                 // One word: the value

const _lock_desc = (_i32 << 4) | 1;                                    // One word: the lock word

const _allocptr_loc = 1;
const _alloclim_loc = 2;
const _sharedVar_loc = 4;

/* Construction protocol (implementation detail).
 *
 * There are two construction paths for shared objects: the regular
 * new T() path, which allocates shared storage and creates a front
 * object for it, and the T.fromRef() path, which creates a front
 * object given an existing storage reference.
 *
 * The job of the constructor is as follows:
 *
 *   - if the first constructor argument value is the object _noalloc
 *     then the constructor should /not/ allocate storage, but should
 *     return immediately and should not inspect any other arguments.  [NOTE: different for arrays!]
 *
 *   - if the first constructor argument is anything else then the
 *     constructor should allocate shared storage, initialize its
 *     _base reference with the shared storage pointer.
 *
 * SharedHeap.alloc(d, obj) takes a descriptor d and an object obj,
 * allocates shared storage, installs the descriptor in the storage,
 * and sets obj._base to the shared memory address.  It returns nothing.
 *
 * SharedHeap.allocArray(n, d) takes a number of elements n and a
 * descriptor d and allocates shared storage, installs the descriptor
 * and number of elements in the storage, and returns the shared
 * object base address.
 */

const _noalloc = {};            // A cookie used in object construction.

/*
 * NOTE: It must be possible to create shared-memory /types/ before registering the heap,
 * since those types will be created as part of the bootstrap process.  So creating a type can't store things
 * in shared memory eagerly.  We can store things in shared memory when the first object of a type is created.
 * (If we have to)
 *
 *
 * 
 *
 * A "shared object" is an index range within the array, wrapped
 * within a JS object.  The JS object places an interpretation on the
 * range of values.  Each shared object type has a constructor, which
 * allocates a new object, an export method that returns a low + length
 * pair (really, two integers) and an import static method that
 * reconstitutes the object from that range.
 *
 * Hm, that's deeply unsafe.
 *
 * Allocation is normally in a local heap (because global allocation
 * is expensive).  Deallocation is explicit for now.
 *
 * By and large, for things to work out well, *all* non-constant or
 * worker-variant information associated with a shared object should
 * be stored in shared memory, not on individual local objects.
 */

var _sab;                       // SharedArrayBuffer used for the heap
var _iab;                       // SharedInt32Array covering the _sab
var _dab;                       // SharedFloat64Array covering the _sab

const SharedHeap = { pid: -1 };	// The pid is altered by SharedHeap.setup().

var sharedVar0;

SharedHeap.allocate =
    function (nbytes) {
	const sixteen = 16*1024*1024;
	if (nbytes < 4096)
	    nbytes = 4096;
	if (nbytes < sixteen) {
	    // Must be power of 2
	    var k = 0;
	    while (nbytes != 1) {
		if (nbytes & 1)
		    nbytes += 1;
		k++;
		nbytes >>= 1;
	    }
	    nbytes <<= k;
	}
	else if (nbytes % sixteen) {
	    // Must be multiple of 16M
	    nbytes = (nbytes + (sixteen - 1)) & ~(sixteen - 1);
	}
	return new SharedArrayBuffer(nbytes);
    };

SharedHeap.setup =
    function (sab, whoami) {
        _sab = sab;
        _iab = new SharedInt32Array(sab);
        _dab = new SharedFloat64Array(sab);
        switch (whoami) {
        case "master":
	    SharedHeap.pid = 0;
            _iab[0] = 0;
            _iab[1] = 4;            // Initial allocation pointer
            _iab[2] = _iab.length;
            _iab[3] = 1;
            sharedVar0 = new SharedVar.ref();
            if (sharedVar0._base != _sharedVar_loc)
                throw new Error("Internal error: bad SharedVar location");
            break;
        case "slave":
	    SharedHeap.pid = Atomics.add(_iab, 3, 1);
            sharedVar0 = SharedVar.ref.fromRef(_sharedVar_loc);
            break;
        default:
            throw new Error("Invalid shared heap initialization specification: " + whoami);
        }
    };

SharedHeap.equals =
    function (a,b) {
        return (a && b) ? a._base === b._base : a === null && b === null;
    };

SharedHeap.allocStorage =
    function (nwords) {
        // For now, use a global free list in shared memory and
        // allocate from it with synchronization.
        //
        // TODO: For better performance go through the usual drudgery:
        // free list management, a local heap to avoid sync overhead,
        // etc.
        for(;;) {
            var v = _iab[_allocptr_loc];
            var t = v + nwords;
            if (t >= _iab[_alloclim_loc])
                throw new Error("OOM");
            if (Atomics.compareExchange(_iab, _allocptr_loc, v, t) == v)
                return v;
        }
    };

SharedHeap.alloc =
    function (d, obj) {
        // TODO: storage management / GC support.
        var nwords = (1+(d&15)+1) & ~1;
        var v = SharedHeap.allocStorage(nwords);
        var iab = _iab;
        obj._base = v;
        iab[v] = d;
        return v;
    };

SharedHeap.allocArray =
    function (n, d) {
        // TODO: storage management / GC support.
        var nwords = 2;
        var nbytes;
        switch ((d >> 4) & 3) {
        case _i32:
        case _ref:
            nwords += (n+1) & ~1;
            nbytes = n*4;
            break;
        case _f64:
            nwords += 2*n;
            nbytes = n*8;
            break;
        }
        var v = SharedHeap.allocStorage(nwords);
        var iab = _iab;
        iab[v] = d;
        iab[v+1] = nbytes;
        return v;
    };


//////////////////////////////////////////////////////////////////////
//
// Primitive arrays.

// TODO: hide this

function SharedArrayConstructor(d, constructor) {
    return function (_a1, _a2, _a3) {
        var p;
        var nelements;
        if (_a1 === _noalloc) {
            p = _a2;
            nelements = _a3;
            if (d != _iab[p])
                throw new Error("Bad reference: unmatched descriptor: wanted " + d + ", got " + _iab[p] + " @" + p);
        }
        else {
            nelements = _a1;    // _a2 and _a3 are not supplied
            p = SharedHeap.allocArray(nelements, d);
        }
        var a = new constructor(_sab, 8+(p*4), nelements);
        a._base = p;
        return a;
    };
}

const SharedArray = {};

SharedArray.int32 =
    SharedArrayConstructor(_array_int32_desc, SharedInt32Array);
SharedArray.int32._desc = _array_int32_desc;
SharedArray.int32.fromRef =
    function (r) {
	if (r == 0) return null;
        return new SharedArray.int32(_noalloc, r, _iab[r+1]/4);
    }

/* Not sure if this is a good idea yet, working on a spec.

SharedArray.ref =
    SharedArrayConstructor(_array_ref, SharedInt32Array);
SharedArray.ref._desc = _array_ref;
SharedArray.ref.fromRef =
    function (r) {
        return new SharedArray.int32(_noalloc, r, _iab[r+1]);
    }
*/

SharedArray.float64 =
    SharedArrayConstructor(_array_float64_desc, SharedFloat64Array);
SharedArray.float64._desc = _array_float64_desc;
SharedArray.float64.fromRef =
    function (r) {
	if (r == 0) return null;
        return new SharedArray.float64(_noalloc, r, _iab[r+1]/8);
    }

//////////////////////////////////////////////////////////////////////
//
// Type constructor for structure types.

const SharedStruct = {};

SharedStruct.int32 = {toString:() => "shared int32"};
SharedStruct.atomic_int32 = {toString:() => "shared atomic int32"};

SharedStruct.float64 = {toString:() => "shared float64"};
SharedStruct.atomic_float64 = {toString:() => "shared atomic float64"};

SharedStruct.ref = {toString:() => "shared ref"};
SharedStruct.atomic_ref = {toString:() => "shared atomic ref"};

// Construct a prototype object for a new shared struct type.
//
// The prototype initially holds just the type's tag.  The tag is just
// a string.
//
// TODO: hide this function.

function SharedObjectProto(tag) {
    this._tag = tag;
}

// All shared struct objects' prototypes share this prototype object.

SharedObjectProto.prototype = {
    toString: function () { return "Shared " + this._tag; } // _tag on the struct objects' prototypes
};

// Construct a fromRef function for a type, given its constructor.
//
// TODO: hide this function.

function SharedObjectFromReffer(constructor) {
    var d = constructor._desc;
    if (!d)
        throw new Error("Bad constructor: no _desc: " + constructor);
    return function (ref) {
	if (ref == 0) return null;
        if (_iab[ref] != d)
            throw new Error("Bad reference: unmatched descriptor: wanted " + d + ", got " + _iab[ref]);
        var l = new constructor(_noalloc);
        l._base = ref;
        return l;
    };
}

SharedStruct.Type =
    function(fields, tag) {
        var lockloc = 0;
        var loc = 1;
        var desc = 0;
        var acc = [];
	var meth = [];
        var ainit = [];		// Always init
        var init = [];		// Init if an object is present
	var zinit = [];		// Init if an object is not present
        var cprop = [];
        for ( var i in fields ) {
            if (!fields.hasOwnProperty(i))
                continue;
            var f = fields[i];
            if (!(typeof f == "object" && f != null))
                throw new Error("Invalid field type");
            if (f === SharedStruct.atomic_float64 && !lockloc) {
                lockloc = loc;
                desc = desc | (_i32 << ((loc-1)*2));
                loc++;
                ainit.push(`_iab[this._base + ${lockloc}] = 0`);
            }
            if (f === SharedStruct.float64 || f === SharedStruct.atomic_float64)
                loc = (loc + 1) & ~1;
            if (i.charAt(0) == '$')
                cprop.push([i, loc]);
            if (f === SharedStruct.int32) {
		var a = true;
                if (i.charAt(0) != '$') {
                    acc.push([i, 
                              `function() { return _iab[this._base + ${loc}] }`,
                              `function(v) { return _iab[this._base + ${loc}] = v; }`]);
		    if (i.charAt(0) != '_') {
			init.push(`_iab[this._base + ${loc}] = _v.${i}`); // undefined => nan => 0
			zinit.push(`_iab[this._base + ${loc}] = 0`);
			a = false;
		    }
		}
		if (a)
                    ainit.push(`_iab[this._base + ${loc}] = 0`);
                desc = desc | (_i32 << ((loc-1)*2));
                loc++;
            }
            else if (f === SharedStruct.atomic_int32) {
                if (i.charAt(0) == '$')
		    throw new Error("Private atomic fields are silly");
                acc.push([i,
                          `function() { return Atomics.load(_iab, this._base + ${loc}) }`,
                          `function(v) { return Atomics.store(_iab, this._base + ${loc}, v) }`]);
		meth.push([`add_${i}`, `function(v) { return Atomics.add(_iab, this._base + ${loc}, v); }`]);
		meth.push([`compareExchange_${i}`,
			   `function(oldval,newval) {
			       return Atomics.compareExchange(_iab, this._base + ${loc}, oldval, newval);
			   }`]);
		if (i.charAt(0) != '_') {
                    init.push(`_iab[this._base + ${loc}] = _v.${i}`);
                    zinit.push(`_iab[this._base + ${loc}] = 0`);
		}
		else
                    ainit.push(`_iab[this._base + ${loc}] = 0`);
                desc = desc | (_i32 << ((loc-1)*2));
                loc++;
            }
            else if (f === SharedStruct.float64) {
		var a = true;
                if (i.charAt(0) != '$') {
                    acc.push([i, 
                              `function() { return _dab[(this._base + ${loc}) >> 1] }`,
                              `function(v) { return _dab[(this._base + ${loc}) >> 1] = v }`]);
		    if (i.charAt(0) != '_') {
			init.push(`_dab[(this._base + ${loc}) >> 1] = _v.hasOwnProperty("${i}") ? _v.${i} : 0.0`);
			zinit.push(`_dab[(this._base + ${loc}) >> 1] = 0.0`);
			a = false;
		    }
		}
		if (a)
                    ainit.push(`_dab[(this._base + ${loc}) >> 1] = 0.0`);
                desc = desc | (_f64 << ((loc-1)*2));
                loc++;
                desc = desc | (_f64 << ((loc-1)*2));
                loc++;
            }
            else if (f === SharedStruct.atomic_float64) {
                if (i.charAt(0) == '$')
		    throw new Error("Private atomic fields are silly");
                acc.push([i,
                          `function() {
                              var b = this._base;
                              while (Atomics.compareExchange(_iab, b+lockloc, 0, 1) != 0)
                                  ;
                              var r = _dab[(b + ${loc}) >> 1];
                              Atomics.store(_iab, b+lockloc, 0);
                              return r; }`,
                          `function(v) {
                              var b = this._base;
                              while (Atomics.compareExchange(_iab, b+lockloc, 0, 1) != 0)
                                  ;
                              var r = _dab[(b + ${loc}) >> 1] = v;
                              Atomics.store(_iab, b+lockloc, 0);
                              return r; }`]);
		meth.push([`add_${i}`,
			   `function(v) {
                               var b = this._base;
                               while (Atomics.compareExchange(_iab, b+lockloc, 0, 1) != 0)
                                   ;
                               var r = _dab[(b + ${loc}) >> 1];
			       _dab[(b + ${loc}) >> 1] += v;
                               Atomics.store(_iab, b+lockloc, 0);
                               return r; }`]);
		meth.push([`compareExchange_${i}`,
			   `function(oldval,newval) {
                               var b = this._base;
                               while (Atomics.compareExchange(_iab, b+lockloc, 0, 1) != 0)
                                  ;
                               var r = _dab[(b + ${loc}) >> 1];
			       if (r == +oldval) 
				   _dab[(b + ${loc}) >> 1] += +newval;
                               Atomics.store(_iab, b+lockloc, 0);
                               return r; }`]);
		if (i.charAt(0) != '_') {
                    init.push(`_dab[(this._base + ${loc}) >> 1] = _v.hasOwnProperty("${i}") ? _v.${i} : 0.0`);
                    zinit.push(`_dab[(this._base + ${loc}) >> 1] = 0.0`);
		}
		else 
                    ainit.push(`_dab[(this._base + ${loc}) >> 1] = 0.0`);
                desc = desc | (_f64 << ((loc-1)*2));
                loc++;
                desc = desc | (_f64 << ((loc-1)*2));
                loc++;
            }
            else if (f === SharedStruct.ref) {
		var a = true;
                if (i.charAt(0) != '$') {
                    acc.push([i, 
                              `function(c) { return c.fromRef(_iab[this._base + ${loc}]) }`,
                              `function(v) { return _iab[this._base + ${loc}] = (v ? v._base : 0); }`]);
		    if (i.charAt(0) != '_') {
			init.push(`var tmp = _v.${i}; _iab[this._base + ${loc}] = (tmp ? tmp._base : 0)`); // undefined => nan => 0
			zinit.push(`_iab[this._base + ${loc}] = 0`);
			a = false;
		    }
		}
		if (a)
                    ainit.push(`_iab[this._base + ${loc}] = 0`);
                desc = desc | (_ref << ((loc-1)*2));
                loc++;
            }
            else if (f === SharedStruct.atomic_ref) {
                if (i.charAt(0) == '$')
		    throw new Error("Private atomic fields are silly");
                acc.push([i,
                          `function(c) { return c.fromRef(Atomics.load(_iab, this._base + ${loc})) }`,
                          `function(v) { return Atomics.store(_iab, this._base + ${loc}, (v ? v._base : 0)) }`]);
		meth.push([`compareExchange_${i}`,
			   `function(c,oldval,newval) {
			       var o = oldval ? oldval._base : 0;
			       var n = newval ? newval._base : 0;
			       return c.fromRef(Atomics.compareExchange(_iab, this._base + ${loc}, o, n));
			   }`]);
		if (i.charAt(0) != '_') {
                    init.push(`var tmp = _v.${i}; _iab[this._base + ${loc}] = (tmp ? tmp._base : 0)`);
                    zinit.push(`_iab[this._base + ${loc}] = 0`);
		}
		else
                    ainit.push(`_iab[this._base + ${loc}] = 0`);
                desc = desc | (_ref << ((loc-1)*2));
                loc++;
            }
            else
                throw new Error("Invalid field type");
        }
        if ((loc-1) > 12)
            throw new Error("Too many fields");
        desc = (desc << 4) | (loc-1);
	var ainits = '';
	for ( var i of ainit )
	    ainits += i + ';\n';
        var inits = '';
        for ( var i of init )
            inits += i + ';\n';
        var zinits = '';
        for ( var i of zinit )
            zinits += i + ';\n';
        var accs = '';
        for ( var [i,g,s] of acc ) {
            if (g)
                accs += `p.get_${i} = ${g};\n`;
            if (s) 
                accs += `p.set_${i} = ${s};\n`;
        }
        var meths = '';
        for ( var [i,m] of meth )
            meths += `p.${i} = ${m};\n`;
        var cprops = '';
        for ( var [i,p] of cprop )
            cprops += `c.${i} = ${p};\n`;
	var finits =
	    zinits != '' || inits != '' ? 
	    `if (typeof _v !== "object" || _v === null) {
                ${zinits}
             }
             else {
                ${inits}
             }` :
	"";
        var code =
            `(function () {
		"use strict";
                var c = function (_v) {
                    if (_v === _noalloc) return;
                    SharedHeap.alloc(${desc}, this);
		    ${ainits}
		    ${finits}
                }
                c._desc = ${desc};
                c.fromRef = SharedObjectFromReffer(c);
                ${cprops}
                var p = new SharedObjectProto(\'${tag ? String(tag) : "(anonymous)"}\');
                ${accs}
		${meths}
                c.prototype = p;
                return c;
            })();`;
	//print(code);
	// TODO: Is this eval() safe?  Note the code that is being run is strict.
        return eval(code);
    };

//////////////////////////////////////////////////////////////////////
//
// SharedVar objecs are simple structs with 'get', 'put' methods
// as well as 'add' and 'compareExchange'.
//
// No initializer is required.

var SharedVar = {};

SharedVar.int32 = 
    (function () {
    	var T = SharedStruct.Type({_cell:SharedStruct.atomic_int32}, "SharedVar.int32");
    	T.prototype.get = T.prototype.get__cell;
    	T.prototype.put = T.prototype.set__cell;
    	T.prototype.add = T.prototype.add__cell;
    	T.prototype.compareExchange = T.prototype.compareExchange__cell;
    	return T;
    })();

SharedVar.float64 =
    (function () {
	var T = SharedStruct.Type({_cell:SharedStruct.atomic_float64}, "SharedVar.float64");
    	T.prototype.get = T.prototype.get__cell;
    	T.prototype.put = T.prototype.set__cell;
    	T.prototype.add = T.prototype.add__cell;
  	T.prototype.compareExchange = T.prototype.compareExchange__cell;
      	return T;
    })();

SharedVar.ref =
    (function () {
    	var T = SharedStruct.Type({_cell:SharedStruct.atomic_ref}, "SharedVar.ref");
    	T.prototype.get = T.prototype.get__cell;
    	T.prototype.put = T.prototype.set__cell;
  	T.prototype.compareExchange = T.prototype.compareExchange__cell;
      	return T;
    })();


//////////////////////////////////////////////////////////////////////
//
// Lock objects are simple structs with 'lock', 'unlock', and 'invoke'
// methods.  No initializer is required.
//
// The mutex code is based on http://www.akkadia.org/drepper/futex.pdf.
//
// There's no support for error checking, recursive mutexes,
// reader/writer locks, or anything like that.  Also no optimization.
//
// Mutex state values:
//   0: unlocked
//   1: locked with no waiters
//   2: locked with possible waiters

// _Lock is exposed to Cond.
const _Lock = SharedStruct.Type({$index: SharedStruct.int32}, "Lock");

var Lock =
    (function () {
	"use strict";

	const $index = _Lock.$index;

	_Lock.prototype.lock = 
	    function () {
		const iab = _iab;
		const index = this._base + $index;
		var c = 0;
		if ((c = Atomics.compareExchange(iab, index, 0, 1)) != 0) {
		    do {
			if (c == 2 || Atomics.compareExchange(iab, index, 1, 2) != 0) {
			    Atomics.futexWait(iab, index, 2, Number.POSITIVE_INFINITY);
			}
		    } while ((c = Atomics.compareExchange(iab, index, 0, 2)) != 0);
		}
	    };

	_Lock.prototype.unlock =
	    function () {
		const iab = _iab;
		const index = this._base + $index;
		var v0 = Atomics.sub(iab, index, 1);
		if (v0 != 1) { // Wake up a waiter if there are any.
		    Atomics.store(iab, index, 0);
		    Atomics.futexWake(iab, index, 1);
		}
	    };
        
	_Lock.prototype.invoke =
	    function (thunk) {
		try {
		    this.lock();
		    return thunk();
		}
		finally {
		    this.unlock();
		}
	    };

	return _Lock;
    })();

//////////////////////////////////////////////////////////////////////
//
// Condition variables.
//
// new Cond({lock:l}) creates a condition variable that can wait on
// the lock 'l'.
//
// cond.wait() atomically unlocks its lock (which must be held by the
// calling thread) and waits for a wakeup on cond.  If there were waiters
// on lock then they are woken as the lock is unlocked.
//
// cond.wake() wakes one waiter on cond and attempts to re-aqcuire
// the lock that it held as it waited.
//
// cond.wakeAll() wakes all waiters on cond.  They will race to
// re-acquire the locks they held as they waited; it needn't all be
// the same locks.
//
// The caller of wake and wakeAll must hold the lock during the call.
//
// (The condvar code is based on http://locklessinc.com/articles/mutex_cv_futex,
// though modified because some optimizations in that code don't quite apply.)

var Cond =
    (function () {
	"use strict";

	const Cond = SharedStruct.Type({lock: SharedStruct.ref, $seq:SharedStruct.int32}, "Cond");
	const $seq = Cond.$seq;
	const $index = _Lock.$index;

	Cond.prototype.wait =
	    function () {
		const loc = this._base + $seq;
		const seq = Atomics.load(_iab, loc);
		const lock = this.get_lock(Lock);
		const index = lock._base + $index;
		lock.unlock();
		var r = Atomics.futexWait(_iab, loc, seq, Number.POSITIVE_INFINITY);
		lock.lock();
	    };

	Cond.prototype.wake =
	    function () {
		const loc = this._base + $seq;
		Atomics.add(_iab, loc, 1);
		Atomics.futexWake(_iab, loc, 1);
	    };

	Cond.prototype.wakeAll =
	    function () {
		const loc = this._base + $seq;
		Atomics.add(_iab, loc, 1);
		// Optimization opportunity: only wake one, and requeue the others
		// (in such a way as to obey the locking protocol properly).
		Atomics.futexWake(_iab, loc, 65535);
	    };

	return Cond;
    })();
