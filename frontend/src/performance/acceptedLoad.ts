/** Only the Performance load policy emits this, after accepting a load. */
const listeners=new Set<()=>void>();
export function acceptedPerformanceLoad():void {for(const fn of listeners)fn();}
export function subscribeAcceptedPerformanceLoad(fn:()=>void):()=>void {listeners.add(fn);return()=>listeners.delete(fn);}
