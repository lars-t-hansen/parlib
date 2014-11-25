const bufsiz = 100;
const Coord =
    new SharedStruct.Type("Coord",
			  {buffer: SharedStruct.ref,        // Items to remove
			   head: SharedStruct.atomic_int32, // Next loc to remove, unless tail==head
			   tail: SharedStruct.atomic_int32, // Next loc to insert, unless (tail+1)%bufsiz==head
			   rdy:  SharedStruct.atomic_int32, // Worker will set this to 1 to signal its readyness
			   lock: SharedStruct.ref,          // Controls critical section
			   cond: SharedStruct.ref           // To wait, if the queue is empty or full
			  });
