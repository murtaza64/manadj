/** Local display events from the existing load-refusal policy. No transport effects. */
import type {ChannelId} from '../playback/mixer';
const listeners=new Set<(deck:ChannelId)=>void>();
export function showLoadBlocked(deck:ChannelId):void { for(const fn of listeners)fn(deck); }
export function subscribeLoadBlocked(fn:(deck:ChannelId)=>void):()=>void {listeners.add(fn);return()=>listeners.delete(fn);}
