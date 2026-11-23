import {useEffect,useState,useSyncExternalStore}from'react';
import type {DeckEngine}from'../playback/DeckEngine';
import{heardRoute,subscribeHeard}from'../playback/heardStore';
import './outputDelayCue.css';
/** A display-clock wait, not an audio/file loading state. */
export function OutputDelayCue({engine,active}:{engine:DeckEngine;active:boolean}){
 const route=useSyncExternalStore(subscribeHeard,heardRoute),seconds=route.on?route.seconds:route.reportedSeconds;
 const[waiting,setWaiting]=useState(false);
 useEffect(()=>{if(!active){setWaiting(false);return;}let timer:ReturnType<typeof setTimeout>|undefined;
 const update=()=>{clearTimeout(timer);const left=engine.getHeardDisplayWaitSeconds(seconds);setWaiting(left>.02);if(left>.02)timer=setTimeout(update,Math.ceil(left*1000)+10);};
 update();const off=engine.subscribe(update);return()=>{off();clearTimeout(timer);};},[engine,active,seconds,route.key]);
 return waiting?<span className="perf-output-delay" role="status" title="The waveform waits for your output latency so it follows the sound. Audio timing is unchanged."><span aria-hidden="true"/>Output delay · {Math.round(seconds*1000)} ms</span>:null;
}
