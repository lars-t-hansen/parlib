/*
 * Utilities for plain js to use shared memory (relatively)
 * conveniently.
 *
 * DRAFT.
 * 25 October 2014 / lhansen@mozilla.com.
 *
 * For documentation and examples see parlib.txt and reference.txt.
 */

/*
 * TODO:
 *  - Storage management.
 *
 *  - Allow structures more than 12 words in size.  That should not be
 *    hard now; the descriptor is really not used for much any more,
 *    and will only be useful for GC.  Also, the descriptor can be
 *    stored in a table off to the side, indexed by the typetag.
 *
 *  - Better hash algorithm, and maybe a bigger field for the hash code
 *    (full word instead of a half word).
 *
 *  - More atomic operations (sub on int/float; and, or, xor on int)
 *
 *  - Utility methods, such as init(x) on SharedVar.
 *
 *  - An array-of-inline-structures type.
 *
 *  - Generally move the design closer to that of TypedObject.
 *
 *  - Performance can be pretty awful, see ../ray3/README.md for more
 *    details.
 *
 *  - Create a WebBarrier type: the master installs a callback on
 *    this.  When *all* the slaves enter (that's the whole point) the
 *    master gets the callback.  Eventually the master calls release
 *    on the barrier to set the slaves going again.  The idea here is
 *    that the master only accesses shared memory while the slaves are
 *    quiescent.
 */

/* Implementation details.
 *
 * Object protocols.
 *
 * Every implementation of a 'struct' or 'array' type must conform to
 * the following:
 *
 *  - the instance must have a "_base" property which is the index
 *    within _iab of the object header.
 *
 * Every implementation of an 'array' type must additionally conform
 * to the following:
 *
 *  - the prototype or instance must have a "bytePtr()" method
 *    which returns the byte offset within the heap of the first
 *    data elemement.
 *
 *
 * Shared memory object layout.
 *
 * Each object maps to an even number of words in the integer mapping
 * of the heap memory ("_iab" in the following).  The low bit of an
 * object address is zero.
 *
 * The first two words of an object are a descriptor with the
 * following fields:
 *
 *   +-+---+------------------------+----+
 *   |0| B | F                      | C  |
 *   +-+---+----------+-------------+----+
 *   |0|     U        |        D         |
 *   +----------------+------------------+
 *    hi                               lo
 *
 * 0 is always zero (making the word a nonnegative int32 value)
 *
 * B are three tag bits:
 *   000  plain-ish object
 *   001  array
 *   010  string
 *   xxx  others unallocated
 *
 * D is an index in the type descriptor table _typetable, where there
 * will be a constructor that is used to convert a raw pointer back to
 * an object.
 *
 * U is unused, it must be zero.
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
 *   The word after the two-word header contains the element count of
 *   the array payload.
 *
 *   The payload begins on the word after the element count (and extra
 *   alignment, for float64 arrays), and the SharedTArray's
 *   bufferOffset will reflect that.
 *
 * If B=010 then the value is a "string" type:
 *
 *   C must be 0
 *
 *   F holds the number of characters in the string
 *
 *   Each halfword after the two-word header holds a character of the
 *   string, in order.
 *   
 *
 * This layout is naive, it does not allow structures of arrays or
 * arrays of structures, and it allows only for small structures.
 *
 * 
 * Shared heap layout.
 *
 * There is one global SharedArrayBuffer, available through global
 * '_sab'.  We map SharedTypedArrays onto this for administration
 * purposes, these are available through '_iab' (int32), '_cab'
 * (uint16), and '_dab' (float64).  All units of allocation are in
 * words of '_iab', all addresses are indices in '_iab'.
 *
 * The low words of '_iab' are allocated as follows:
 *
 *   0: unused, the "null ref" points here
 *   1: iab next-free pointer (variable, update with CAS)
 *   2: iab limit pointer (constant, pointer past the end)
 *   3: next process ID
 *   4: unused
 *   5: unused
 *   6: unused
 *   7: unused
 *   8: sharedVar0: starts here
 *   9: ...
 *   
 * The next-free pointer must be kept 8-byte aligned (2 words).
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

const _string_desc = (2 << 28);	                                       // Note F contains the length

const _lock_desc = (_i32 << 4) | 1;                                    // One word: the lock word

const _allocptr_loc = 1;
const _alloclim_loc = 2;
const _sharedVar_loc = 8;

/* Construction protocol (implementation detail).
 *
 * There are two construction paths for shared objects: the regular
 * new T() path, which allocates shared storage and creates a front
 * object for it, and the path used by _ObjectFromPointer(), which
 * creates a front object given an existing storage reference.
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
 * SharedHeap._allocObject(d, obj) takes a descriptor d and an object obj,
 * allocates shared storage, installs the descriptor in the storage,
 * and sets obj._base to the shared memory address.  It returns nothing.
 *
 * SharedHeap._allocArray(n, d) takes a number of elements n and a
 * descriptor d and allocates shared storage, installs the descriptor
 * and number of elements in the storage, and returns the shared
 * object base address.
 */

const _noalloc = {};            // A cookie used in object construction.

var _sab;                       // SharedArrayBuffer used for the heap
var _iab;                       // SharedInt32Array covering the _sab
var _cab;			// SharedUint16Array covering the _sab
var _dab;                       // SharedFloat64Array covering the _sab

var _IAB;
var _DAB;

const _typetable = {};          // Local map from integer to constructor
const _typename = {};		// Local map from integer to name (for user-defined types)
var _typetag = 1;               // No type has tag 0, this counter is for system types only, max value=255

_typetable[0] =                 // Provide a sane handler for tag 0
    function () {
        throw new Error("Type tag 0 was looked up: not right");
    };

const SharedHeap = {
    pid: -1,		        // The pid is altered by SharedHeap.setup()
};

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
	if (SharedHeap.pid != -1)
	    throw new Error("Heap already initialized");
        _sab = sab;
        _iab = new SharedInt32Array(sab);
	_cab = new SharedUint16Array(sab);
        _dab = new SharedFloat64Array(sab);
	_IAB = _iab;
	_DAB = _dab;
        switch (whoami) {
        case "master":
            SharedHeap.pid = 0;
            _iab[0] = 0;
            _iab[1] = _sharedVar_loc; // Initial allocation pointer
            _iab[2] = _iab.length;
            _iab[3] = 1;
            sharedVar0 = new SharedVar.ref();
            if (sharedVar0._base != _sharedVar_loc)
                throw new Error("Internal error: bad SharedVar location");
            break;
        case "slave":
            SharedHeap.pid = Atomics.add(_iab, 3, 1);
            sharedVar0 = _ObjectFromPointer(_sharedVar_loc);
            break;
        default:
            throw new Error("Invalid shared heap initialization specification: " + whoami);
        }
    };

SharedHeap.equals =
    function (a,b) {
        return (a && b) ? a._base === b._base : a === null && b === null;
    };

SharedHeap._allocStorage =
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

SharedHeap._allocObject =
    function (d, tag, obj) {
        // TODO: storage management / GC support.
        var nwords = (2+(d&15)+1) & ~1;
        var v = SharedHeap._allocStorage(nwords);
        var iab = _iab;
        obj._base = v;
        iab[v] = d;
        iab[v+1] = tag;
        return v;
    };

SharedHeap._allocString =
    function (nelem, tag, d) {
	var nwords = 2 + (((nelem + 3) & ~3) >> 1);
        var v = SharedHeap._allocStorage(nwords);
        var iab = _iab;
        iab[v] = d;
        iab[v+1] = tag;
        return v;
    };

SharedHeap._allocArray =
    function (nelem, tag, d) {
        // TODO: storage management / GC support.
        var nwords = 3;
        var nbytes;
        switch ((d >> 4) & 3) {
        case _i32:
        case _ref:
            nwords = (nwords+nelem+1) & ~1;
            break;
        case _f64:
            nwords += 1 + 2*nelem;
            break;
        }
        var v = SharedHeap._allocStorage(nwords);
        var iab = _iab;
        iab[v] = d;
        iab[v+1] = tag;
        iab[v+2] = nelem;
        return v;
    };

// This local object cache is valid in the presence of GC if it is
// cleared on GC, and in the presence of manual storage management if
// objects are purged from the cache when they are freed.

// On ray3, the miss rate is extremely sensitive to the hash function
// and size.  With a shift of 1, which is the "rational" shift, I see
// a miss rate barely above zero.  With a shift of 0 (which includes
// the redundant low bit and misses the high bit) it jumps to 12%.
//
// As for size, the low miss ratio is with a 2K entry cache, while
// with a 1K entry cache (which again misses the high bit) the miss
// rate jumps to 12% again.
//
// The cache is arguably a hack, but it's hard to argue with its
// efficacy in reducing front objects, and it makes it possible to
// focus on other performance problems.

const _fromref = Array.build(1024*2, (x) => 0);
const _fromobj = Array.build(1024*2, (x) => null);

var _nonnulls = 0;
var _probes = 0;
var _misses = 0;

function _ObjectFromPointer(p) {
    //_probes++;

    if (p == 0)
	return null;

    //_nonnulls++;

    var k = (p >> 1) & (1024*2-1);
    if (_fromref[k] == p)
        return _fromobj[k];

    //_misses++;

    var constructor = _typetable[_iab[p+1] & 65535];
    switch (_iab[p] >> 28) {
    case 0:
        var obj = new constructor(_noalloc);
        obj._base = p;
	break;
    case 1:
	var obj = new constructor(_noalloc, p, _iab[p+2]);
	break;
    case 2:
	var obj = new constructor(_noalloc);
	obj._base = p;
	break;
    default:
	throw new Error("Bad constructor");
    }
    _fromref[k] = p;
    _fromobj[k] = obj;
    return obj;
};


//////////////////////////////////////////////////////////////////////
//
// Arrays are reference types.

const SharedArray = {};

(function () {
    "use strict";

    function SharedArrayConstructor(d, constructor, typetag) {
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
		p = SharedHeap._allocArray(nelements, typetag, d);
            }
            var a = new constructor(_sab, (d == _array_float64_desc ? 16 : 12)+(p*4), nelements);
            a._base = p;
            // A SharedArray.ref is currently just a SharedInt32Array, we don't want
            // to place these methods on the prototype.
	    //
	    // It appears 'this[index]' is faster than 'a[index]', by a little bit,
	    // probably because 'this' is readily available.
            if (d == _array_ref_desc) {
		a.get = function (index) { return _ObjectFromPointer(this[index]); }
		a.put = function (x, v) { this[x] = v ? v._base : 0; };
            }
            return a;
	};
    }

    var itag = _typetag++;
    SharedArray.int32 =
        SharedArrayConstructor(_array_int32_desc, SharedInt32Array, itag);
    _typetable[itag] = SharedArray.int32;
    SharedInt32Array.prototype.bytePtr =
        function () {
            return this._base*4 + 12;
        };

    var rtag = _typetag++;
    SharedArray.ref =
        SharedArrayConstructor(_array_ref_desc, SharedInt32Array, rtag);
    _typetable[rtag] = SharedArray.ref;
    // bytePtr is inherited from SharedArray.int32

    var ftag = _typetag++;
    SharedArray.float64 =
        SharedArrayConstructor(_array_float64_desc, SharedFloat64Array, ftag);
    _typetable[ftag] = SharedArray.float64;
    SharedFloat64Array.prototype.bytePtr =
        function () {
            return this._base*4 + 16; // *4 even for double arrays, but also padding
        };
})();


//////////////////////////////////////////////////////////////////////
//
// Structures are reference types.

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

function _SharedObjectProto(tag) {
    this._tag = tag;
}

// All shared struct objects' prototypes share this prototype object.

_SharedObjectProto.prototype = {
    toString: function () { return "Shared " + this._tag; } // _tag on the struct objects' prototypes
};

function _create(__txt) {
    return eval(__txt);
}

// The type tag is a hash of the tagname, the field names, and the field types.
// I'm using TAB for a separator since that is unlikely to be used in existing
// tagnames and field names.

function _CreateTypetag(tagname, fields) {
    var signature = tagname;
    for ( var i in fields ) {
        if (!fields.hasOwnProperty(i))
            continue;
	signature += "\t" + i + "\t";
	switch (fields[i]) {
	case SharedStruct.int32:
	    signature += "i";
	    break;
	case SharedStruct.atomic_int32:
	    signature += "I";
	    break;
	case SharedStruct.float64:
	    signature += "d";
	    break;
	case SharedStruct.atomic_float64:
	    signature += "D";
	    break;
	case SharedStruct.ref:
	    signature += "r";
	    break;
	case SharedStruct.atomic_ref:
	    signature += "R";
	    break;
	default:
            throw new Error("Invalid field type");
	}
    }
    
    // http://www.cse.yorku.ca/~oz/hash.html, this is the djb2 algorithm.

    var hash = 5381;
    for ( var i=0 ; i < signature.length ; i++ )
	hash = ((hash << 5) + hash) + signature.charCodeAt(i);  // hash * 33 + c
    var h = hash;
    hash = Math.abs(hash|0);
    if (hash < 256)
	hash += 256;		// The first 256 entires are reserved for the system
    hash = (hash & 0xFFFF) ^ (hash >>> 16); // 16 bits for the field - probably too little
    return hash;
}

SharedStruct.Type =
    function(tagname, fields) {
        if (typeof tagname != "string")
            throw new Error("Tag name must be a string");

        var lockloc = 0;
        var loc = 2;            // Header followed by type tag
        var desc = 0;
        var acc = [];
        var meth = [];
        var ainit = [];         // Always init
        var init = [];          // Init if an object is present
        var zinit = [];         // Init if an object is not present
        var cprop = [];
	var need_iab = false;
	var need_dab = false;
        for ( var i in fields ) {
            if (!fields.hasOwnProperty(i))
                continue;
            var f = fields[i];
            if (!(typeof f == "object" && f != null))
                throw new Error("Invalid field type " + f);
            if (f === SharedStruct.atomic_float64 && !lockloc) {
		need_iab = true;
                lockloc = loc;
                desc = desc | (_i32 << ((loc-2)*2));
                loc++;
                ainit.push(`_iab[this._base + ${lockloc}] = 0`);
            }
            if (f === SharedStruct.float64 || f === SharedStruct.atomic_float64)
                loc = (loc + 1) & ~1;
            if (i.charAt(0) == '$')
                cprop.push([i, loc]);
            if (f === SharedStruct.int32) {
		need_iab = true;
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
                desc = desc | (_i32 << ((loc-2)*2));
                loc++;
            }
            else if (f === SharedStruct.atomic_int32) {
		need_iab = true;
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
                desc = desc | (_i32 << ((loc-2)*2));
                loc++;
            }
            else if (f === SharedStruct.float64) {
		need_dab = true;
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
                desc = desc | (_f64 << ((loc-2)*2));
                loc++;
                desc = desc | (_f64 << ((loc-2)*2));
                loc++;
            }
            else if (f === SharedStruct.atomic_float64) {
                if (i.charAt(0) == '$')
                    throw new Error("Private atomic fields are silly");
		need_dab = true;
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
                desc = desc | (_f64 << ((loc-2)*2));
                loc++;
                desc = desc | (_f64 << ((loc-2)*2));
                loc++;
            }
            else if (f === SharedStruct.ref) {
                // For arrays we need no further information, the descriptor has all the information.
                // For structures the first field after the header must be the index within the
                // local type table of the appropriate constructor.
                //
                // On the other hand that means a longer path for type reconstruction since we must
                // test the descriptor.
		need_iab = true;
                var a = true;
                if (i.charAt(0) != '$') {
                    acc.push([i, 
                              `function() { return _ObjectFromPointer(_iab[this._base + ${loc}]); }`,
                              `function(v) { return _iab[this._base + ${loc}] = (v ? v._base : 0); }`]);
                    if (i.charAt(0) != '_') {
                        init.push(`var tmp = _v.${i}; _iab[this._base + ${loc}] = (tmp ? tmp._base : 0)`); // undefined => nan => 0
                        zinit.push(`_iab[this._base + ${loc}] = 0`);
                        a = false;
                    }
                }
                if (a)
                    ainit.push(`_iab[this._base + ${loc}] = 0`);
                desc = desc | (_ref << ((loc-2)*2));
                loc++;
            }
            else if (f === SharedStruct.atomic_ref) {
                if (i.charAt(0) == '$')
                    throw new Error("Private atomic fields are silly");
		need_iab = true;
                acc.push([i,
                          `function() { return _ObjectFromPointer(Atomics.load(_iab, this._base + ${loc})) }`,
                          `function(v) { return Atomics.store(_iab, this._base + ${loc}, (v ? v._base : 0)) }`]);
                meth.push([`compareExchange_${i}`,
                           `function(oldval,newval) {
                               var o = oldval ? oldval._base : 0;
                               var n = newval ? newval._base : 0;
                               return _ObjectFromPointer(Atomics.compareExchange(_iab, this._base + ${loc}, o, n));
                           }`]);
                if (i.charAt(0) != '_') {
                    init.push(`var tmp = _v.${i}; _iab[this._base + ${loc}] = (tmp ? tmp._base : 0)`);
                    zinit.push(`_iab[this._base + ${loc}] = 0`);
                }
                else
                    ainit.push(`_iab[this._base + ${loc}] = 0`);
                desc = desc | (_ref << ((loc-2)*2));
                loc++;
            }
            else
                throw new Error("Invalid field type");
        }
        if ((loc-2) > 12)
            throw new Error("Too many fields");
        desc = (desc << 4) | (loc-2);
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
        var t = '';
        for ( var [i,g,s] of acc ) {
            if (g || s) {
		if (t != '') t += ",";
		t += `${i}: {`;
                if (g)
                    t += `get: ${g},`;
                if (s) 
                    t += `set: ${s}`;
                t += `}`;
            }
	    if (t != '')
		accs = `Object.defineProperties(p, {${t}});\n`;
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
	var typetag = _CreateTypetag(tagname, fields);
	// Caching _iab and _dab helps a little bit but not all that much (3% on ray3).
	// It sure would be nice to make those 'const' and not 'var', but several
	// levels of order-of-initialization need to change, notably, prototype methods
	// must be attached early (because they are captured by client code, eg SharedVar),
	// and the heap arrays must be initialized late (because types are created before
	// initialization).
	//
	// Not creating a new prototype does not make any difference.
	//
	// Having one defineProperties call or several makes no difference.  Moving the init
	// of c.prototype makes no difference.
	//
	// Is the use of eval an impediment to optimization?  No evidence of that so far.
        var code =
            `(function () {
                "use strict";
		${need_iab ? "var _iab;" : ""}
		${need_dab ? "var _dab;" : ""}
                var c = function (_v) {
		    ${need_iab ? "_iab = _IAB;" : ""}
		    ${need_dab ? "_dab = _DAB;" : ""}
                    if (_v === _noalloc) return;
                    SharedHeap._allocObject(${desc}, ${typetag}, this);
                    ${ainits}
                    ${finits}
                }
                ${cprops}
                var p = new _SharedObjectProto(\'${tagname}\');
                ${accs}
                ${meths}
                c.prototype = p;
                return c;
            })();`;
        var c = _create(code);
	if (_typetable[typetag])
	    throw new Error("Type conflict: New type " + tagname + " conflicts with existing type " + _typename[typetag]);
	_typetable[typetag] = c;
	_typename[typetag] = tagname;
        return c;
    };


//////////////////////////////////////////////////////////////////////
//
// Strings are reference types.  For now they are immutable.

const _string_tag = _typetag++;

const SharedString =
    function (s) {
	if (s === _noalloc) return;
	if (typeof s != "string")
	    throw new Error("Initializing string required");
	var len = s.length;
	var p = SharedHeap._allocString(len, _string_tag, _string_desc | (len << 4)); 
	this._base = p;
	var cp = (p+2)*2;
	for ( var i=0 ; i < len ; i++ )
	    _cab[cp++] = s.charCodeAt(i);
    };

_typetable[_string_tag] = SharedString;

SharedString.compare =
    function (a, b) {
	var x = a._base;
	var y = b._base;
	if ((_iab[x] >> 28) != 2 || (_iab[y] >> 28) != 2)
	    throw new Error("Compare only works on strings");
	var lx = (_iab[x] >> 4) & 0xFFFFFF;
	var ly = (_iab[y] >> 4) & 0xFFFFFF;
	var lm = Math.min(lx, ly);
	var px = (x+2)*2;
	var py = (y+2)*2;
	for ( var i=0 ; i < lm ; i++, px++, py++ ) {
	    var v = _cab[px] - _cab[py];
	    if (v != 0)
		return (v < 0) ? -1 : 1;
	}
	if (lx == ly)
	    return 0;
	return (lx < ly) ? -1 : 1;
    };

SharedString.prototype.toString =
    function () { return "SharedString " + this.extract() };

SharedString.prototype.extract =
    function () {
	var len = this.length;
	var s = "";
	var cp = (this._base+2)*2;
	for ( var i=0 ; i < len ; i++, cp++ )
	    s += String.fromCharCode(_cab[cp]);
	return s;
    };

SharedString.prototype.charAt =
    function (i) {
	var p = this._base;
	var len = (_iab[p] >> 4) & 0xFFFFFF;
	i = +i;
	if (i < 0 || i >= len)
	    return "";
	return String.fromCharCode(_cab[(p+2)*2 + i]);
    };

SharedString.prototype.charCodeAt =
    function (i) {
	var p = this._base;
	var len = (_iab[p] >> 4) & 0xFFFFFF;
	i = +i;
	if (i < 0 || i >= len)
	    return NaN;
	return _cab[(this._base+2)*2 + i];
    };

Object.defineProperties(SharedString.prototype,
			{length: {get: function() { return (_iab[this._base] >> 4) & 0xFFFFFF }}});

//////////////////////////////////////////////////////////////////////
//
// SharedVar objecs are simple structs with 'get', 'put' methods
// as well as 'add' and 'compareExchange'.
//
// No initializer is required.

var SharedVar = {};

SharedVar.int32 = 
    (function () {
        var T = SharedStruct.Type("SharedVar.int32", {_cell:SharedStruct.atomic_int32});
        T.prototype.get = function () { return this._cell }
        T.prototype.put = function (v) { this._cell = v; }
        T.prototype.add = T.prototype.add__cell;
        T.prototype.compareExchange = T.prototype.compareExchange__cell;
        return T;
    })();

SharedVar.float64 =
    (function () {
        var T = SharedStruct.Type("SharedVar.float64", {_cell:SharedStruct.atomic_float64});
        T.prototype.get = function () { return this._cell }
        T.prototype.put = function (v) { this._cell = v; }
        T.prototype.add = T.prototype.add__cell;
        T.prototype.compareExchange = T.prototype.compareExchange__cell;
        return T;
    })();

SharedVar.ref =
    (function () {
        var T = SharedStruct.Type("SharedVar.ref", {_cell:SharedStruct.atomic_ref});
        T.prototype.get = function () { return this._cell }
        T.prototype.put = function (v) { this._cell = v; }
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
const _Lock = SharedStruct.Type("Lock", {$index: SharedStruct.int32});

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

        const Cond = SharedStruct.Type("Cond", {lock: SharedStruct.ref, $seq:SharedStruct.int32});
        const $seq = Cond.$seq;
        const $index = _Lock.$index;

        Cond.prototype.wait =
            function () {
                const loc = this._base + $seq;
                const seq = Atomics.load(_iab, loc);
                const lock = this.lock;
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
