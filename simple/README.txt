A simple library providing synchronization abstractions, assuming as
little as possible about the client code (and thus providing minimal
help with data abstraction and so on).

There's a pattern that's used in all these abstractions: shared memory
for a data type, eg Lock, is allocated and initialized by one agent
(often the main thread, but it doesn't matter) before JS objects
representing the data type are created in all the participating
agents.  The number of shared locations needed for the data type is
given by the NUMLOCS property, eg, Lock.NUMLOCS.  The initialize()
method is then used to initialize memory, eg, Lock.initialize().
Finally, the data type is instantiated using 'new', eg, new Lock().
