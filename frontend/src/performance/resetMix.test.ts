import{afterEach,expect,it,vi}from'vitest';import{createMixReset,resetMixKey}from'./resetMix';
afterEach(()=>vi.useRealTimers());
it('resets only the approved controls once after 700ms, freezes target, release cancels',()=>{
 vi.useFakeTimers();const reset=createMixReset(),mixer={setEq:vi.fn(),setFilter:vi.fn(),setTrim:vi.fn(),setFader:vi.fn()};
 expect(resetMixKey('A')).toBe("'");expect(resetMixKey('C')).toBe("'");expect(resetMixKey('B')).toBe('\\');expect(resetMixKey('D')).toBe('\\');
 reset.begin('C',mixer);vi.advanceTimersByTime(699);expect(mixer.setEq).not.toHaveBeenCalled();reset.cancel('C');vi.advanceTimersByTime(1);expect(mixer.setFader).not.toHaveBeenCalled();
 reset.begin('C',mixer);reset.begin('C',mixer);vi.advanceTimersByTime(700);
 expect(mixer.setEq.mock.calls).toEqual([['C','high',.5],['C','mid',.5],['C','low',.5]]);
 expect(mixer.setFilter).toHaveBeenCalledWith('C',0);expect(mixer.setTrim).toHaveBeenCalledWith('C',.5);expect(mixer.setFader).toHaveBeenCalledExactlyOnceWith('C',1);
 vi.advanceTimersByTime(2000);expect(mixer.setFader).toHaveBeenCalledTimes(1);expect(reset.get('C').done).toBe(true);reset.cancel('C');expect(reset.get('C').held).toBe(false);
 reset.begin('B',mixer,()=>false);vi.advanceTimersByTime(700);expect(mixer.setFader).toHaveBeenCalledTimes(1);
});
