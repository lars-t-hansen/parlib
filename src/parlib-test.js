// Most of this is white-box

load("parlib.js")

SharedHeap.setup(new SharedArrayBuffer(1*1024*1024), "master");

testLock();
testIntSharedVar();
testFloatSharedVar();
testRefSharedVar();
testIntArray();
testFloatArray();
testAdd();

function testLock() {
    print("testLock");
    var l = new Lock();
    var k = Lock.fromRef(l._base);
    assertEq(l._base, k._base);
    assertEq(l.index, k.index);
    assertEq(sharedVar0._base, _sharedVar_loc);
    assertEq(SharedHeap.equals(l, k), true);
    var m = new Lock();
    assertEq(SharedHeap.equals(l, m), false);
    // Locks and int vars are laid out the same so they
    // can be aliased, but we can't alias onto a ref var.
    var thrown=false;
    try { 
	var y = SharedVar.ref.fromRef(m._base);
    } catch (e) { var thrown=true; }
    assertEq(thrown, true);
}

function testIntSharedVar() {
    print("testIntSharedVar");
    var x = new SharedVar.int32();
    var y = SharedVar.int32.fromRef(x._base);
    x.put(37);
    assertEq(y.get(), 37);
}

function testFloatSharedVar() {
    print("testFloatSharedVar");
    var x = new SharedVar.float64()
    var y = SharedVar.float64.fromRef(x._base);
    x.put(3.14159);
    assertEq(y.get(), 3.14159);
    assertEq(SharedHeap.equals(x, y), true);
}

function testRefSharedVar() {
    print("testRefSharedVar");
    var x = new SharedVar.ref()
    var y = SharedVar.ref.fromRef(x._base);
    assertEq(SharedHeap.equals(x,y), true);
    var l = new Lock();
    x.put(l);
    var q = y.get(Lock);
    assertEq(SharedHeap.equals(l, q), true);
}

function testIntArray() {
    print("testIntArray");
    var v = new SharedArray.int32(100);
    assertEq(v.length, 100);
    var w = SharedArray.int32.fromRef(v._base)
    assertEq(v._base, w._base);
    assertEq(v.length, w.length);
    assertEq(v.byteOffset, w.byteOffset);
    v[0] = 37;
    assertEq(w[0], 37);
    assertEq(SharedHeap.equals(v, w), true);
    // Can't alias some other type onto an array
    var thrown=false;
    try { 
	var y = SharedVar.int32.fromRef(w._base);
    } catch (e) { var thrown=true; }
    assertEq(thrown, true);
}

function testFloatArray() {
    print("testFloatArray");
    var q = new SharedArray.float64(100);
    assertEq(q.length, 100);
    var r = SharedArray.float64.fromRef(q._base)
    assertEq(q._base, r._base);
    assertEq(q.length, r.length);
    assertEq(q.byteOffset, r.byteOffset);
    q[0] = 1.4142;
    assertEq(r[0], 1.4142);
    assertEq(SharedHeap.equals(q, r), true);
    // Can't alias onto an int array
    var thrown=false;
    try { 
	var y = SharedArray.int32.fromRef(r._base);
    } catch (e) { var thrown=true; }
    assertEq(thrown, true);
}

function testAdd() {
    print("testAdd");
    var T = new SharedStruct.Type({x: SharedStruct.atomic_int32});
    var q = new T({x:1});
    assertEq(q.get_x(), 1);
    q.add_x(1);
    assertEq(q.get_x(), 2);
}
