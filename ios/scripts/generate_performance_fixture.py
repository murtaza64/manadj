#!/usr/bin/env python3
"""Deterministic synthetic PCM plus MWF1, Android FFT/hops/quantization. No music source."""
from pathlib import Path
import struct, wave
import numpy as np
root = Path(__file__).resolve().parents[1] / 'Manadj/Resources'
rate = 44100
edges = [20, 60, 150, 400, 1000, 2500, 6000, 12000, 20000]
t = np.arange(rate * 24) / rate
hann = .5 - .5 * np.cos(2 * np.pi * np.arange(1024) / 1024)
for name, hz in [('A', 220), ('B', 261.63)]:
    beat = np.exp(-((t * 128 / 60) % 1) * 14)
    audio = np.sin(2*np.pi*hz*t)*.12 + np.sin(2*np.pi*hz*1.5*t)*.04 + np.sin(2*np.pi*60*t)*beat*.25
    pcm = (audio*24000).astype('<i2')
    with wave.open(str(root / ('synthetic-'+name+'.wav')), 'wb') as f:
        f.setparams((1,2,rate,len(pcm),'NONE','not compressed')); f.writeframes(pcm.tobytes())
    mono = pcm.astype(float)/32768
    peaks = np.max(np.abs(mono[:len(mono)//128*128].reshape(-1,128)),axis=1)
    frames = np.lib.stride_tricks.sliding_window_view(mono,1024)[::512]
    spectrum = np.fft.rfft(frames*hann,axis=1)
    bands = []
    for lo,hi in zip(edges,edges[1:]):
        left = int(np.ceil(lo*1024/rate)); right = min(512,int(np.ceil(hi*1024/rate))-1)
        power = np.sum(np.abs(spectrum[:,left:right+1])**2,axis=1)
        bands.append(2*np.sqrt(power)/(1024*np.sqrt(np.mean(hann*hann))))
    def quant(x):return (np.sqrt(np.clip(x,0,1))*255+.5).astype('u1').tobytes()
    p = quant(peaks); b = quant(np.array(bands).T)
    header = bytearray(76)
    struct.pack_into('<4sH',header,0,b'MWF1',1)
    struct.pack_into('<IdIII',header,8,rate,24.,128,512,1024)
    header[32]=8;struct.pack_into('<f',header,36,.5)
    struct.pack_into('<9f',header,40,*edges)
    (root / ('synthetic-'+name+'.mwf')).write_bytes(header+struct.pack('<II',len(p),len(b)//8)+p+b)
# Use the production preview reducer so tests cannot accidentally substitute
# full detail data into the browser-preview cache again.
import sys
sys.path.insert(0, str(root.parents[2]))
from backend.waveform_data import build_preview_blob
for name in ['A', 'B']:
    (root / ('synthetic-'+name+'-preview.mwf')).write_bytes(build_preview_blob((root / ('synthetic-'+name+'.mwf')).read_bytes()))
print('Generated synthetic A/B WAV, full MWF and separate 256-bin previews')
