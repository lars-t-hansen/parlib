Parallel ray tracer, take 2.

Here there is a shared scene graph in shared memory.  The scene graph
is immutable.  Whenever the worker needs an object in the scene graph
it must reify the object, which means determining the actual type of
the object and then constructing the front object with the appropriate
constructor.  Front objects are eligible for garbage collection.

Work is scheduled by breaking the scene into pixel strips and adding
those strips to a work queue.  The master does that scheduling.

When the slaves read sentinel nodes they exit the work loop and
decrement a counter; the last one out sends a message to the master
that computation is done and the master will display the image.

This is currently (2014-10-22) deadly slow.  With shadows, reflection,
and antialiasing *disabled* it takes 26.5s to trace the image using 6
workers on my MBP, which is probably something like 30x slower than
ray2 with the same feature set (0.8s).

Reasons why it could be slow:

  - slow object reconstruction protocol (allocation, general overhead)

  - polymorphism and bailouts in the jitted code because some
    structures are proper JS objects and others are weird things with
    getters and setters

  - bugs, undiagnosed
