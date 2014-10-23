// Most of this is white-box

load("parlib.js")

var Q = new SharedStruct.Type("Q",
			      {x: SharedStruct.atomic_int32});

var T = SharedStruct.Type("T",
			  {i:SharedStruct.int32,
			   f:SharedStruct.float64,
			   r:SharedStruct.ref});

SharedHeap.setup(SharedHeap.allocate(1*1024*1024), "master");

testLock();
testIntSharedVar();
testFloatSharedVar();
testRefSharedVar();
testIntArray();
testFloatArray();
testAdd();
testTypes();

function testLock() {
    print("testLock");
    var l = new Lock();
    var k = _ObjectFromPointer(l._base);
    assertEq(l._base, k._base);
    assertEq(l.index, k.index);
    assertEq(sharedVar0._base, _sharedVar_loc);
    assertEq(SharedHeap.equals(l, k), true);
    var m = new Lock();
    assertEq(SharedHeap.equals(l, m), false);
}

function testIntSharedVar() {
    print("testIntSharedVar");
    var x = new SharedVar.int32();
    var y = _ObjectFromPointer(x._base);
    x.put(37);
    assertEq(y.get(), 37);
}

function testFloatSharedVar() {
    print("testFloatSharedVar");
    var x = new SharedVar.float64()
    var y = _ObjectFromPointer(x._base);
    x.put(3.14159);
    assertEq(y.get(), 3.14159);
    assertEq(SharedHeap.equals(x, y), true);
}

function testRefSharedVar() {
    print("testRefSharedVar");
    var x = new SharedVar.ref()
    var y = _ObjectFromPointer(x._base);
    assertEq(SharedHeap.equals(x,y), true);
    var l = new Lock();
    x.put(l);
    var q = y.get();
    assertEq(SharedHeap.equals(l, q), true);
}

function testIntArray() {
    print("testIntArray");
    var v = new SharedArray.int32(100);
    assertEq(v.length, 100);
    var w = _ObjectFromPointer(v._base)
    assertEq(v._base, w._base);
    assertEq(v.length, w.length);
    assertEq(v.byteOffset, w.byteOffset);
    v[0] = 37;
    assertEq(w[0], 37);
    assertEq(SharedHeap.equals(v, w), true);
}

function testFloatArray() {
    print("testFloatArray");
    var q = new SharedArray.float64(100);
    assertEq(q.length, 100);
    var r = _ObjectFromPointer(q._base)
    assertEq(q._base, r._base);
    assertEq(q.length, r.length);
    assertEq(q.byteOffset, r.byteOffset);
    q[0] = 1.4142;
    assertEq(r[0], 1.4142);
    assertEq(SharedHeap.equals(q, r), true);
}

function testAdd() {
    print("testAdd");
    var q = new Q({x:1});
    assertEq(q.x, 1);
    q.add_x(1);
    assertEq(q.x, 2);
}

function testTypes() {
    print("testTypes");
    var a = new SharedArray.int32(1);
    var obj = new T({i:10, f:3.14, r:a});
    assertEq(obj.i, 10);
    obj.i = 20;
    assertEq(obj.i, 20);
    assertEq(obj.f, 3.14);
    obj.f *= 2;
    assertEq(obj.f, 6.28);
    assertEq(obj.r != null, true);
    assertEq(SharedHeap.equals(a, obj.r), true);
}
