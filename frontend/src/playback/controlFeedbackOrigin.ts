/** Display-only machine-origin guard, separate from audio scheduling and capture. */
let machineDepth=0;
export function machineControlFeedback():boolean{return machineDepth>0;}
export function withoutControlFeedback<T>(fn:()=>T):T {machineDepth++;try{return fn();}finally{machineDepth--;}}
