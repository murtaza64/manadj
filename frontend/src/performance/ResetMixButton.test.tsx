// @vitest-environment jsdom
import{act}from'react';import{createRoot}from'react-dom/client';import{afterEach,expect,it,vi}from'vitest';
import{ResetMixButton}from'./ResetMixButton';import{mixReset}from'./resetMix';import{focusDeck,_resetControlFocusForTests}from'./controlFocus';
const fixture=vi.hoisted(()=>({active:true}));const mixer=vi.hoisted(()=>({setEq:vi.fn(),setFilter:vi.fn(),setTrim:vi.fn(),setFader:vi.fn()}));
vi.mock('../hooks/useDeck',()=>({useDeck:()=>({deck:'A'})}));vi.mock('../hooks/useMixer',()=>({useMixer:()=>mixer}));vi.mock('../contexts/viewActive',()=>({useViewActive:()=>fixture.active}));
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
afterEach(()=>{mixReset.cancel('A');vi.useRealTimers();vi.clearAllMocks();_resetControlFocusForTests();fixture.active=true;});
it('pointer/accessible hold releases cancel and focus/view changes cannot retarget',()=>{
 vi.useFakeTimers();const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
 const render=()=>act(()=>root.render(<ResetMixButton/>));render();const button=host.querySelector('button')!;button.setPointerCapture=vi.fn();
 const pointer=(type:string,extra={})=>act(()=>button.dispatchEvent(new MouseEvent(type,{bubbles:true,button:0,...extra})));
 const tick=(ms:number)=>act(()=>vi.advanceTimersByTime(ms));
 try{pointer('pointerdown');tick(699);pointer('pointerup');tick(1);expect(mixer.setFader).not.toHaveBeenCalled();
 pointer('pointerdown');act(()=>focusDeck('C'));tick(700);expect(mixer.setFader).not.toHaveBeenCalled();
 pointer('pointerdown');fixture.active=false;render();tick(700);expect(mixer.setFader).not.toHaveBeenCalled();fixture.active=true;render();
 pointer('pointerdown');const library=document.createElement('div');library.className='perf-keyboard-scope';library.dataset.libraryFocus='true';host.append(library);tick(700);expect(mixer.setFader).not.toHaveBeenCalled();library.remove();
 pointer('pointerdown',{ctrlKey:true});tick(700);expect(mixer.setFader).not.toHaveBeenCalled();
 act(()=>button.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true})));tick(700);expect(mixer.setFader).toHaveBeenCalledExactlyOnceWith('A',1);expect(button.className).toContain('done');
 act(()=>button.dispatchEvent(new KeyboardEvent('keyup',{key:'Enter',bubbles:true})));expect(button.className).not.toContain('holding');
 }finally{act(()=>root.unmount());host.remove();}
});
