import {useMemo,useSyncExternalStore} from 'react';
import type {DeckEngine} from '../playback/DeckEngine';
import {heardRoute,subscribeHeard} from '../playback/heardStore';
/** Display only: markers retain track coordinates, gestures keep the raw engine. */
export function useHeardWaveformClock(engine:DeckEngine){
 const route=useSyncExternalStore(subscribeHeard,heardRoute);
 const seconds=route.on?route.seconds:route.reportedSeconds;
 return useMemo(()=>({getPlayhead:()=>engine.getHeardDisplayPlayhead(seconds)}),[engine,seconds,route.key]);
}
