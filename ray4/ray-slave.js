importScripts("../src/parlib.js");
importScripts("../src/BoundedBuffer.js");
importScripts("../src/Framework.js");
importScripts("ray-common.js");

const slave = new Slave();

slave.addHandler("rayinit", () => rayinit(slave.getVariable("coord").get()));
slave.addHandler("raytrace", (task) => raytrace(task.bottom, task.bottom+task.height));
