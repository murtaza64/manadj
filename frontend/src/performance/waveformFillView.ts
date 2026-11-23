import {PLAY_MARKER_FRACTION}from'../utils/waveformZoom';
/** Underlay and GL share the displayed clock, not the ahead-of-output engine. */
export function waveformFillTimeAt(displayPlayhead:number,span:number,x:number,width:number):number {
 return displayPlayhead-span*PLAY_MARKER_FRACTION+(x/width)*span;
}
