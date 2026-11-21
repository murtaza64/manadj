#!/usr/bin/env python3
"""Small native-decoder fixtures from generated PCM only. Requires ffmpeg, never real music."""
from pathlib import Path
import subprocess
root = Path(__file__).resolve().parents[1] / 'Manadj/Resources'
for extension, codec in [('mp3','libmp3lame'), ('m4a','aac'), ('flac','flac'), ('aiff','pcm_s16be')]:
    subprocess.run(['ffmpeg','-v','error','-y','-i',str(root/'synthetic-A.wav'),'-t','2','-c:a',codec,str(root/('synthetic-codec.'+extension))],check=True)
print('Generated synthetic decoder matrix, MP3/AAC/FLAC/AIFF')
