import{expect,it}from'vitest';import{waveformFillTimeAt}from'./waveformFillView';
it('anchors fill at the heard cursor and keeps feature track-time unchanged',()=>{
 const heard=9.8,span=8,width=1000;expect(waveformFillTimeAt(heard,span,250,width)).toBeCloseTo(heard);
 const feature=10;const x=(feature-(heard-span*.25))/span*width;expect(waveformFillTimeAt(heard,span,x,width)).toBeCloseTo(feature);
 expect(waveformFillTimeAt(10,span,250,width)-waveformFillTimeAt(heard,span,250,width)).toBeCloseTo(.2);
});
