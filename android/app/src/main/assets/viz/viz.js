var Js=Object.defineProperty;var Qs=(Ie,re,X)=>re in Ie?Js(Ie,re,{enumerable:!0,configurable:!0,writable:!0,value:X}):Ie[re]=X;var Y=(Ie,re,X)=>Qs(Ie,typeof re!="symbol"?re+"":re,X);(function(){"use strict";const Ie=[["voyage","Voyage"],["g02-voyage-prime","Voyage Prime"],["g05-materia-shards","Materia Shards"],["g02-materia","Materia"],["g03-materia-deep","Materia Deep"],["g07-materia-metric","Materia Metric"],["g04-materia-arc","Materia Arc"],["g05-materia-mercury","Materia Mercury"],["g03-solar-crown","Solar Crown"],["g07-seasons-neon","Seasons Neon"],["g07-voyage-hardcut","Voyage Hardcut"],["g05-voyage-deckmix","Voyage Deckmix"],["tunnel","Tunnel"],["g04-tunnel-saga","Tunnel Saga"],["g05-tunnel-deckmix","Tunnel Deckmix"],["g02-mirror-ladder","Mirror Ladder"],["g07-crt","CRT"],["g01-warp-nebula","Warp Nebula"],["g06-orrery","Orrery"],["g01-odyssey-drift","Odyssey Drift"],["g05-odyssey-cracks","Odyssey Cracks"],["g03-charge-bloom","Charge Bloom"],["g06-nursery","Nursery"],["odyssey","Odyssey"],["aurora","Aurora"],["plasma","Plasma"],["silk","Silk"],["strata","Strata"],["nova","Nova"],["siphon","Siphon"],["ladder","Ladder"],["pulse","Pulse"],["orbit","Orbit"]],re=[[1,.1,.1],[0,1,.25],[.2,.45,1]];function X(t){return Math.min(1,t.low*.5+t.mid*.3+t.high*.2)}function Pe(t,e=0){return((250-t*210+e)%360+360)%360}const Ta=`
attribute vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }
`,Ia=`
precision mediump float;
uniform sampler2D u_prev;
uniform vec2 u_res;
void main() { gl_FragColor = texture2D(u_prev, gl_FragCoord.xy / u_res); }
`;function Wt(t,e){const o=(i,b)=>{const p=t.createShader(i);return p?(t.shaderSource(p,b),t.compileShader(p),t.getShaderParameter(p,t.COMPILE_STATUS)?p:(console.warn("[glPreset] shader compile failed",t.getShaderInfoLog(p)),null)):null},r=o(t.VERTEX_SHADER,Ta),a=o(t.FRAGMENT_SHADER,e);if(!r||!a)return null;const s=t.createProgram();return s?(t.attachShader(s,r),t.attachShader(s,a),t.linkProgram(s),t.getProgramParameter(s,t.LINK_STATUS)?s:(console.warn("[glPreset] program link failed",t.getProgramInfoLog(s)),null)):null}function Ot(t,e){const o=new Map,r=t.getProgramParameter(e,t.ACTIVE_UNIFORMS);for(let a=0;a<r;a++){const s=t.getActiveUniform(e,a);if(!s)continue;const i=s.name.replace(/\[0\]$/,""),b=t.getUniformLocation(e,s.name);b&&o.set(i,{location:b,type:s.type,size:s.size})}return o}class Pa{constructor(e){Y(this,"spec");Y(this,"canvas");Y(this,"pipeline",null);Y(this,"contextLost",!1);Y(this,"warned",new Set);this.spec=e,this.canvas=document.createElement("canvas"),this.canvas.addEventListener("webglcontextlost",o=>{o.preventDefault(),this.contextLost=!0}),this.canvas.addEventListener("webglcontextrestored",()=>{this.contextLost=!1,this.pipeline=null})}dispose(){var e,o;this.pipeline=null,(o=(e=this.canvas.getContext("webgl"))==null?void 0:e.getExtension("WEBGL_lose_context"))==null||o.loseContext()}setup(){const e=this.canvas.getContext("webgl");if(!e)return null;const o=Wt(e,this.spec.fragment);if(!o)return null;const r=e.createBuffer();e.bindBuffer(e.ARRAY_BUFFER,r),e.bufferData(e.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),e.STATIC_DRAW);const a=i=>{const b=e.getAttribLocation(i,"a_pos");e.enableVertexAttribArray(b),e.vertexAttribPointer(b,2,e.FLOAT,!1,0,0)};e.useProgram(o),a(o);let s=null;if(this.spec.feedback){if(s=Wt(e,Ia),!s)return null;e.useProgram(s),a(s),e.useProgram(o)}return{gl:e,program:o,copyProgram:s,locations:Ot(e,o),copyLocations:s?Ot(e,s):new Map,textures:null,framebuffers:null,prevIndex:0,width:0,height:0}}ensureTargets(e,o,r){if(!this.spec.feedback||e.textures&&e.width===o&&e.height===r)return;const{gl:a}=e;if(e.textures)for(const v of e.textures)a.deleteTexture(v);if(e.framebuffers)for(const v of e.framebuffers)a.deleteFramebuffer(v);const s=()=>{const v=a.createTexture();a.bindTexture(a.TEXTURE_2D,v),a.texImage2D(a.TEXTURE_2D,0,a.RGBA,o,r,0,a.RGBA,a.UNSIGNED_BYTE,null),a.texParameteri(a.TEXTURE_2D,a.TEXTURE_MIN_FILTER,a.LINEAR),a.texParameteri(a.TEXTURE_2D,a.TEXTURE_MAG_FILTER,a.LINEAR),a.texParameteri(a.TEXTURE_2D,a.TEXTURE_WRAP_S,a.CLAMP_TO_EDGE),a.texParameteri(a.TEXTURE_2D,a.TEXTURE_WRAP_T,a.CLAMP_TO_EDGE);const u=a.createFramebuffer();return a.bindFramebuffer(a.FRAMEBUFFER,u),a.framebufferTexture2D(a.FRAMEBUFFER,a.COLOR_ATTACHMENT0,a.TEXTURE_2D,v,0),[v,u]},[i,b]=s(),[p,x]=s();a.bindFramebuffer(a.FRAMEBUFFER,null),e.textures=[i,p],e.framebuffers=[b,x],e.prevIndex=0,e.width=o,e.height=r}setUniform(e,o,r,a){var b,p,x,v,u,w,g;const s=k=>{this.warned.has(o)||(this.warned.add(o),console.warn(`[glPreset] uniform ${o}: ${k}`))},i=k=>typeof k=="number"?[k]:k;if(r.type===e.FLOAT)if(r.size===1){const k=typeof a=="number"?a:(s("array sent to scalar; using [0]"),(b=i(a)[0])!=null?b:0);e.uniform1f(r.location,k)}else{const k=i(a);k.length!==r.size&&s(`length ${k.length} vs declared [${r.size}]; truncating/padding`);const d=new Float32Array(r.size);for(let _=0;_<r.size;_++)d[_]=(p=k[_])!=null?p:0;e.uniform1fv(r.location,d)}else if(r.type===e.FLOAT_VEC2){const k=i(a);k.length<2&&s("needs 2 components"),e.uniform2f(r.location,(x=k[0])!=null?x:0,(v=k[1])!=null?v:0)}else if(r.type===e.FLOAT_VEC3){const k=i(a);k.length<3&&s("needs 3 components"),e.uniform3f(r.location,(u=k[0])!=null?u:0,(w=k[1])!=null?w:0,(g=k[2])!=null?g:0)}else s(`unsupported uniform type 0x${r.type.toString(16)}`)}render(e,o,r,a){if(this.contextLost||o<1||r<1){e.fillStyle="#000",e.fillRect(0,0,o,r);return}this.pipeline||(this.pipeline=this.setup());const s=this.pipeline;if(!s){e.fillStyle="#000",e.fillRect(0,0,o,r);return}const{gl:i}=s;(this.canvas.width!==o||this.canvas.height!==r)&&(this.canvas.width=o,this.canvas.height=r),this.ensureTargets(s,o,r),i.viewport(0,0,o,r),i.useProgram(s.program);const b=s.locations.get("u_res");b&&i.uniform2f(b.location,o,r);const p=this.spec.uniforms(a);for(const[x,v]of Object.entries(p)){const u=s.locations.get(x);u&&this.setUniform(i,x,u,v)}if(this.spec.feedback&&s.textures&&s.framebuffers){const x=s.prevIndex,v=1-x;i.activeTexture(i.TEXTURE0),i.bindTexture(i.TEXTURE_2D,s.textures[x]);const u=s.locations.get("u_prev");u&&i.uniform1i(u.location,0),i.bindFramebuffer(i.FRAMEBUFFER,s.framebuffers[v]),i.drawArrays(i.TRIANGLE_STRIP,0,4),i.bindFramebuffer(i.FRAMEBUFFER,null),i.useProgram(s.copyProgram),i.bindTexture(i.TEXTURE_2D,s.textures[v]);const w=s.copyLocations.get("u_res");w&&i.uniform2f(w.location,o,r);const g=s.copyLocations.get("u_prev");g&&i.uniform1i(g.location,0),i.drawArrays(i.TRIANGLE_STRIP,0,4),s.prevIndex=v}else i.bindFramebuffer(i.FRAMEBUFFER,null),i.drawArrays(i.TRIANGLE_STRIP,0,4);e.drawImage(this.canvas,0,0)}}function ue(t){return new Pa(t)}const Lt=t=>`vec3(${t[0].toFixed(3)}, ${t[1].toFixed(3)}, ${t[2].toFixed(3)})`,Da=t=>{let e=Math.floor(Math.abs(t))+2654435769>>>0;return e=Math.imul(e^e>>>16,569420461)>>>0,e=Math.imul(e^e>>>15,1935289751)>>>0,e=(e^e>>>15)>>>0,e/4294967296},Ea=`
precision highp float;
uniform sampler2D u_prev;
uniform vec2 u_res;
uniform float u_time;
uniform float u_low;
uniform float u_lowSlow;     // motion-grade low: gravity-wave phase rate (erratic-motion law)
uniform float u_mid;
uniform float u_midSlow;    // motion-grade mid: churn/warp rate (erratic-motion law)
uniform float u_high;
uniform float u_kick;
uniform float u_snare;
uniform float u_centroid;  // harmonic content: palette phase
uniform float u_specHue;   // slow-tracked centroid (~1s EMA): dust hue follows spectral content
uniform float u_drop;      // excitement WITH bass
uniform float u_buildup;   // excitement WITHOUT bass
uniform float u_zoom;
uniform float u_rotStep;
uniform float u_decay;
uniform float u_seed;
uniform float u_spawn;
uniform float u_rippleAge;  // seconds since the last strong kick
uniform float u_rippleAmp;  // that kick's captured strength
uniform float u_sustain;    // bass-weighted sustained loudness
uniform float u_armPhase;   // spiral-arm drift, BPM-locked when gridded
uniform float u_dust;       // disk cloud / fine-dust gain
uniform float u_palette;    // palette blend 0..3
uniform float u_charge;     // bass-ring charge (accumulated kick energy)
uniform float u_spawnSnare; // snare-driven star burst gain
uniform float u_hueRot;     // DUST FIX v3: per-song hue anchor + slow spectral travel, in TURNS 0..1

const vec3 LOW = ${Lt(re[0])};
const vec3 HIGH = ${Lt(re[2])};

// DUST FIX v3: value-preserving hue ROTATION in YIQ chroma-plane. rot is in
// TURNS; luminance (Y) is untouched by construction so gains/brightness are
// unchanged. Negatives clamped (rotation can push a channel below 0).
vec3 hueRotate(vec3 c, float rot) {
  float y = dot(c, vec3(0.299, 0.587, 0.114));
  float i = dot(c, vec3(0.596, -0.274, -0.322));
  float q = dot(c, vec3(0.211, -0.523, 0.312));
  float h = atan(q, i) + rot * 6.28318;
  float chroma = sqrt(i * i + q * q);
  i = chroma * cos(h);
  q = chroma * sin(h);
  return max(vec3(0.0), vec3(
    y + 0.956 * i + 0.621 * q,
    y - 0.272 * i - 0.647 * q,
    y - 1.106 * i - 1.703 * q
  ));
}

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

float fbm(vec2 p) {
  float v = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 4; i++) {
    v += amp * noise(p);
    p = p * 2.03 + vec2(17.3, 9.1);
    amp *= 0.5;
  }
  return v;
}

// iq cosine palette: deep-space blues/violets/pinks that TRAVEL — phase
// rides time and the spectral centroid, warmth rides the drop.
vec3 pal0(float t) { return vec3(0.42, 0.14, 0.1) + vec3(0.42, 0.24, 0.14) * cos(6.28318 * (vec3(1.0, 0.9, 0.6) * t + vec3(0.0, 0.15, 0.25))); }
vec3 pal1(float t) { return vec3(0.45, 0.28, 0.42) + vec3(0.25, 0.35, 0.5) * cos(6.28318 * (vec3(1.0, 0.85, 0.7) * t + vec3(0.0, 0.2, 0.45))); }
vec3 pal2(float t) { return vec3(0.14, 0.36, 0.32) + vec3(0.3, 0.5, 0.45) * cos(6.28318 * (vec3(0.9, 1.0, 0.8) * t + vec3(0.1, 0.3, 0.5))); }
vec3 pal3(float t) { return vec3(0.5, 0.38, 0.24) + vec3(0.48, 0.42, 0.34) * cos(6.28318 * (vec3(1.0, 0.9, 0.8) * t + vec3(0.0, 0.12, 0.25))); }

// Branchless continuous palette: the slider MORPHS between the four
// (0 ember → 1 nebula → 2 aurora → 3 solar) instead of switching.
vec3 palette(float t) {
  float x = clamp(u_palette, 0.0, 3.0);
  vec3 c = mix(pal0(t), pal1(t), clamp(x, 0.0, 1.0));
  c = mix(c, pal2(t), clamp(x - 1.0, 0.0, 1.0));
  c = mix(c, pal3(t), clamp(x - 2.0, 0.0, 1.0));
  return c + vec3(0.1, -0.02, -0.05) * u_drop - vec3(0.06, 0.02, -0.04) * u_buildup;
}

float starShape(vec2 f, float size) {
  float d2 = dot(f, f);
  float core = exp(-d2 * 1100.0 / size);
  float halo = exp(-d2 * 140.0 / size) * 0.2;
  float spikes = (exp(-abs(f.x) * 190.0 / size) * exp(-abs(f.y) * 16.0 / size)
    + exp(-abs(f.y) * 190.0 / size) * exp(-abs(f.x) * 16.0 / size)) * 0.55;
  return core + halo + spikes;
}

vec3 starScatter(vec2 c, float density, float sizeScale, float gate, float gain) {
  vec2 q = c * density;
  vec2 cell = floor(q);
  // Per-axis seed mixing: adding one scalar to both axes made the sin-hash
  // align stars into moiré diagonals across the lattice.
  vec2 sc = cell + vec2(fract(u_seed * 0.7131) * 61.7, fract(u_seed * 0.3719) * 43.1);
  vec2 pos = vec2(hash(sc + 1.3), hash(sc.yx + 4.7)) * 0.7 + 0.15;
  vec2 f = fract(q) - pos;
  float on = step(gate - 0.09 * u_spawn, hash(sc * 1.618 + 9.7));
  float size = (0.5 + 1.5 * hash(sc.yx * 2.113)) * sizeScale;
  float bright = 0.4 + 0.6 * hash(sc + 17.9);
  // Star tint samples the traveling palette at each star's own hash phase
  // (wide span) so the scatter picks up spectral color instead of a fixed
  // cool/warm ramp. Luminance is unchanged (starShape * on * bright * gain).
  vec3 tint = palette(hash(sc.yx + 29.3) * 1.6 + u_time * 0.02);
  return hueRotate(mix(tint, HIGH, 0.2), u_hueRot) * starShape(f, size) * on * bright * gain;
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  float aspect = u_res.x / u_res.y;
  vec2 c = (uv - 0.5) * vec2(aspect, 1.0);
  float r = length(c);
  float ang = atan(c.y, c.x);
  float t = u_time;
  vec2 px = 1.0 / u_res;

  // ---- Warp: differential rotation + two NON-circular motions —
  // a turbulent churn field (mids knead the accumulated sky) and a
  // traveling kick ripple (each strong kick sends a displacement wave
  // through everything on screen, Tunnel-style physicality).
  float rot = u_rotStep * (0.35 + 1.4 * exp(-r * 2.2));
  float cs = cos(rot);
  float sn = sin(rot);
  vec2 w = mat2(cs, -sn, sn, cs) * c / u_zoom;
  vec2 dirW = r > 1e-4 ? c / r : vec2(0.0);
  vec2 churn = (vec2(
    fbm(c * 2.6 + t * 0.12),
    fbm(c * 2.6 + vec2(7.7, 3.1) - t * 0.09)
  ) - 0.5) * (0.002 + 0.018 * u_midSlow + 0.012 * u_buildup);  // motion: slow bands (erratic-motion law)
  float waveFront = 0.16 + u_rippleAge * 0.9;
  float rippleWave = exp(-pow((r - waveFront) * 9.0, 2.0)) * exp(-u_rippleAge * 2.4) * u_rippleAmp;
  vec2 ripple = dirW * rippleWave * 0.035;
  // BLACK HOLE, localized: the event-horizon radius is the bass ring;
  // the lens lives INSIDE it (gaussian in r/horizon), so distortion churns
  // the interior while the field outside stays legible. Swirl is a hint,
  // not a whirlpool.
  float horizon = (0.14 + 0.1 * u_low) * (1.0 + 0.07 * u_charge);
  float lens = (0.4 * u_low + 1.5 * u_kick) * (1.0 + 0.9 * u_charge) * exp(-pow(r / horizon, 2.0) * 1.4);
  float drag = lens * 0.12;
  float dcs = cos(drag);
  float dsn = sin(drag);
  w = mat2(dcs, -dsn, dsn, dcs) * w;
  vec2 lensPull = dirW * lens * 0.055;
  vec2 src = (w + churn + ripple + lensPull) / vec2(aspect, 1.0) + 0.5;

  // Chromatic aberration: radial RGB split, widening through the drop
  // and blowing out along the ripple wavefront.
  vec2 ab = dirW * (0.0012 + 0.004 * u_drop + 0.003 * u_kick + 0.01 * rippleWave)
    / vec2(aspect, 1.0);
  ab *= u_dust; // fringe amount rides the dust param (human note)
  // fringe fix: hue-steerable fringes -- rotate the field to the anchor
  // frame, split channels there, rotate back. Clamped >= 0 (hueRotate can
  // go slightly negative) so the unsharp feedback loop stays stable.
  float fringeRot = 0.0; // CLASSIC red/blue aberration fluid (human: keep some presets classic)
  vec3 tapA = texture2D(u_prev, src + ab).rgb;
  vec3 tapC = texture2D(u_prev, src).rgb;
  vec3 tapB = texture2D(u_prev, src - ab).rgb;
  vec3 sampled = max(vec3(0.0), hueRotate(vec3(
    hueRotate(tapA, -fringeRot).r,
    hueRotate(tapC, -fringeRot).g,
    hueRotate(tapB, -fringeRot).b
  ), fringeRot));
  // Unsharp: the anti-mush pass — boost against a 4-tap blur so stars
  // and arms stay crisp through endless resampling.
  vec3 blur = (texture2D(u_prev, src + vec2(px.x, 0.0)).rgb
    + texture2D(u_prev, src - vec2(px.x, 0.0)).rgb
    + texture2D(u_prev, src + vec2(0.0, px.y)).rgb
    + texture2D(u_prev, src - vec2(0.0, px.y)).rgb) * 0.25;
  vec3 sky = max(vec3(0.0), sampled * 1.35 - blur * 0.35) * u_decay;

  // ---- Steady layers, injected at (1 - decay).
  vec3 fresh = vec3(0.0);
  // The bass circle stops being a circle: the low band kneads its rim
  // (two angular modes + a kick-synced tremor), so the core's SHAPE
  // follows the bassline, not just its size.
  // Electrical vibration: two fast noise bands arcing around the rim —
  // the bass circle hums like a live wire, violently under a kick.
  float volt = (noise(vec2(ang * 14.0 + t * 3.0, t * 22.0)) - 0.5)
    + 0.5 * (noise(vec2(ang * 30.0 - t * 5.0, t * 37.0)) - 0.5);
  float bassWarp = u_low * (0.2 * sin(ang * 3.0 + t * 1.7) + 0.13 * sin(ang * 5.0 - t * 2.3))
    + 0.16 * u_kick * sin(ang * 7.0 + t * 9.0)
    + volt * (0.14 * u_low + 0.32 * u_kick);
  float rc = r * (1.0 - bassWarp * exp(-r * 3.0));
  float heart = exp(-rc * rc * (260.0 - 130.0 * u_kick));
  float corona = exp(-rc * (7.0 - 3.0 * u_low));
  // Gravity waves: concentric rings breathing out of the core with the
  // bassline itself (not just kicks) — sustained lows keep the center alive.
  // motion: slow bands (erratic-motion law) — gravity-wave travel rate
  float gravity = sin(rc * 46.0 - t * (3.0 + 9.0 * u_lowSlow)) * 0.5 + 0.5;
  float gravityGain = u_low * (0.5 + 0.8 * u_kick);
  // Gravity ripple color: a warm slice of the traveling palette, biased by
  // the spectral hue, replacing the fixed ember/LOW mix. Gain unchanged.
  vec3 gravityColor = hueRotate(palette(0.05 + t * 0.015 + u_specHue * 0.5), u_hueRot);
  fresh += gravityColor
    * pow(gravity, 4.0) * exp(-r * 5.0) * gravityGain;
  // The event horizon ring: a wide ember glow + a thin white-hot arc,
  // both jittering with the voltage field — THE bass element. Interior is
  // dark (centerDim), so the ring reads as the edge of the black hole.
  float arcJitter = volt * (0.012 + 0.05 * u_kick + 0.022 * u_low);
  // Focused + evolving: the ring CHARGES with kick energy (color runs
  // ember → orange → white-hot as charge builds) and each kick discharges
  // a wave from the horizon (the ripple's new launch point).
  float ringGlow = exp(-pow((r - horizon - arcJitter) * 52.0, 2.0));
  float ringCore = exp(-pow((r - horizon - arcJitter) * 210.0, 2.0));
  float bassOn = smoothstep(0.06, 0.3, u_low);
  // Ring color: a warm palette slice (spectral-hue biased) charges toward a
  // warmer palette accent, then to white-hot at high charge. The palette
  // supplies the hue; the charge→white ramp and gains preserve luminance.
  vec3 chargeColor = mix(palette(0.02 + u_specHue * 0.5), palette(0.12 + u_specHue * 0.5), clamp(u_charge, 0.0, 1.0));
  chargeColor = mix(chargeColor, vec3(1.0, 0.97, 0.92), clamp(u_charge - 0.6, 0.0, 0.4) * 2.5);
  fresh += chargeColor * ringGlow * (0.12 + 0.6 * u_low + 1.1 * u_kick + 0.5 * u_charge);
  fresh += mix(chargeColor, vec3(1.0), 0.5 * u_kick) * ringCore
    * (0.3 + 1.3 * bassOn + 2.4 * u_kick + 0.8 * u_charge);
  // Coal heart: a deep, low-luma slice of the traveling palette (spectral-hue
  // biased) instead of a fixed dark red — it still whitens under a kick and
  // the outer corona rides LOW. Kept dark (palette floor) so it reads as coal;
  // gains/kick-whiten preserve luminance.
  vec3 coal = palette(0.0 + u_specHue * 0.5) * 0.55;
  fresh += mix(coal, vec3(1.0, 0.8, 0.7), 0.5 * u_kick) * heart * (0.5 + 1.2 * u_low + 1.4 * u_kick);
  fresh += mix(coal, LOW, 0.4) * corona * (0.1 + 0.6 * u_low + 0.35 * u_kick);
  // Radial dimmer keeps the middle dark so dust/stars read against it.
  float centerDim = smoothstep(horizon * 0.45, horizon * 1.2, r);
  // Anamorphic lens streak across the core — the spacey money shot. Both
  // ends of the mix now sample the traveling palette (a wide phase offset for
  // the cool end, spectral-hue biased) instead of a fixed steel-blue.
  float streak = exp(-abs(c.y) * 110.0) * exp(-abs(c.x) * (4.5 - 1.5 * u_drop));
  fresh += hueRotate(mix(palette(0.7 + u_specHue * 0.5), palette(t * 0.02), 0.65), u_hueRot) * streak * (0.25 + 1.2 * u_low + 0.8 * u_kick);
  // The disk: spiral lanes + clouds in the TRAVELING palette.
  float arm = sin(ang * 2.0 + log(r + 0.06) * 5.0 - u_armPhase + 0.5 * u_mid * sin(ang * 3.0 + r * 6.0 + t * 0.7));
  float lanes = pow(0.5 + 0.5 * arm, 3.0) * smoothstep(0.06, 0.2, r) * exp(-r * 1.8);
  float cloudField = fbm(vec2(ang * 2.2 + r * 3.0 - t * 0.15, r * 5.0 + t * 0.06));
  float cloud = pow(cloudField, 2.4);
  // Wide phase span + spatial drift: the old 0.7·cloudField span sampled
  // under half a palette period (and blend positions average cosines
  // flatter still) — dust came out monochrome at many slider stops.
  // SPECTRAL DUST TINT: the dust/disk palette phase is biased by the
  // slow-tracked centroid (u_specHue, ~1s EMA) so dust hue follows spectral
  // content — brighter spectra push the disk color across the wheel.
  vec3 diskColor = hueRotate(palette(cloudField * 1.5 + r * 0.35 + ang * 0.1 + t * 0.012 + u_centroid * 0.4 + u_specHue * 0.8), u_hueRot);
  // Kick reverberation: the traveling wavefront LIGHTS the dust it passes
  // through (displacement alone read as subtle; this makes it audible).
  float reverb = 1.0 + 2.6 * rippleWave;
  float midGate = smoothstep(0.04, 0.3, u_mid);
  fresh += diskColor * lanes * (0.1 + 1.2 * u_mid) * (0.5 + cloud) * u_dust * centerDim * midGate * reverb;
  fresh += diskColor * cloud * exp(-r * 2.4) * u_mid * 0.45 * u_dust * centerDim * midGate * reverb;
  // HIGH NEBULA: distinct physics from the mid dust — finer scale,
  // counter-rotation, electric blue-white tint, fast shimmer flicker.
  float wisp = fbm(vec2(ang * 6.0 - t * 0.5, r * 10.0 + t * 0.25));
  float shimmer = 0.6 + 0.4 * sin(t * 13.0 + wisp * 24.0);
  vec3 electric = hueRotate(mix(vec3(0.4, 0.9, 1.0), palette(0.6 + t * 0.03), 0.65), u_hueRot);
  fresh += electric * pow(wisp, 3.2) * shimmer * smoothstep(0.12, 0.5, r)
    * (0.08 + 1.7 * u_high) * u_dust * reverb;
  sky += fresh * (1.0 - u_decay) * (3.2 + 1.6 * u_sustain);

  // High-transient nebula PUFFS: stamped into the feedback at full
  // strength (like the old stars, but cloud-natured) — they persist,
  // shear into the spiral, and fade. Snare powder stays as-is.
  if (u_spawn > 0.01) {
    vec2 sOff = vec2(fract(u_seed * 0.7131) * 21.7, fract(u_seed * 0.3719) * 13.1);
    float puff = pow(fbm(c * 7.0 + sOff), 3.5);
    sky += electric * puff * smoothstep(0.1, 0.4, r) * u_spawn * 0.9;
  }

  // ---- Transient stamps.
  if (u_kick > 0.02) {
    float ringR = 0.1 + 0.05 * u_kick;
    float shock = exp(-pow((r - ringR) * 38.0, 2.0))
      + 0.6 * exp(-pow((r - ringR * 1.7) * 30.0, 2.0));
    // Shockwave hue from the traveling palette (spectral-hue biased) mixed
    // toward a warm-white accent, replacing the fixed LOW->warm ramp. Kick
    // gain / drop scaling unchanged (luminance identical).
    sky += mix(palette(0.05 + u_specHue * 0.5), vec3(1.0, 0.9, 0.8), 0.5) * shock * u_kick * (1.15 + 0.8 * u_drop);
    // Whole-frame punch: a brief lift so the kick lands everywhere.
    sky *= 1.0 + 0.1 * u_kick;
  }
  if (u_snare > 0.03) {
    float arc = exp(-pow((r - 0.3) * 30.0, 2.0)) * pow(0.5 + 0.5 * sin(ang * 3.0 + u_seed), 2.0);
    sky += palette(0.3 + t * 0.02) * arc * u_snare * 0.7;
  }
  if (u_spawn > 0.003 || u_spawnSnare > 0.003) {
    float reach = smoothstep(0.05, 0.18, r);
    // Highs live in the nebula now (puffs above); only the snare powder
    // keeps discrete star points — the hit you liked. Palette-tinted so
    // the slider reaches them too.
    sky += starScatter(c + 11.3, 16.0, 2.8, 0.984, u_spawnSnare * 1.2) * reach
      * mix(vec3(1.0), palette(0.15), 0.45);
  }

  // Film grain — fine, a touch louder through the drop.
  sky += (hash(gl_FragCoord.xy + fract(t) * 191.0) - 0.5) * (0.012 + 0.02 * u_drop);

  // Palette grade: the whole frame leans toward the palette hue, so the
  // blend slider is legible even while bass-red owns the center.
  vec3 grade = palette(0.35 + u_centroid * 0.2);
  sky = mix(sky, sky * (0.4 + grade * 1.5), 0.24);
  // Buildups cool and dim slightly (tension), drops bloom.
  sky *= 0.72 + 0.45 * max(u_drop, u_sustain) - 0.05 * u_buildup;
  float m = max(sky.r, max(sky.g, sky.b));
  if (m > 0.8) {
    sky *= (0.8 + 0.2 * (1.0 - exp(-(m - 0.8) * 3.0))) / m;
  }
  gl_FragColor = vec4(max(sky, 0.0), 1.0);
}
`,Fa={id:"voyage",name:"Voyage",hiRes:!0,params:[{id:"stars",label:"star density",min:0,max:2,step:.05,default:1},{id:"dust",label:"dust amount",min:0,max:2,step:.05,default:1},{id:"palette",label:"palette blend (ember→nebula→aurora→solar)",min:0,max:3,step:.05,default:1},{id:"persistence",label:"persistence",min:.5,max:2,step:.05,default:1},{id:"speed",label:"flight speed",min:.2,max:2.5,step:.05,default:1}],create:()=>{let t=0,e=999,o=0,r=0,a=0,s=0,i=0,b=.5,p=0,x=0,v=null;return ue({fragment:Ea,feedback:!0,uniforms:u=>{var E,R,D,H,q,O,W,F;const w=t>0?Math.min(.1,Math.max(0,u.time-t)):.016666666666666666;t=u.time;const g=X(u.bands),k=(E=u.bandsSlow)!=null?E:u.bands,d=X(k),_=(R=u.params.speed)!=null?R:1,f=(D=u.params.persistence)!=null?D:1,n=Math.min(1,Math.max(0,(u.bands.low-.2)/.5)),T=1-Math.exp(-w/.35);a+=(u.trend.excitement*n-a)*T,s+=(u.trend.excitement*(1-n)-s)*T;const C=a,M=s,c=Math.min(1,g*1.4),l=Math.min(1,d*1.4),m=Math.max(C,.7*l),P=1+(.08+.7*m+3.6*u.impulse.low*(.5+.5*m))*_*w-.3*M*w;r+=w*((H=u.beat)!=null&&H.bpm?u.beat.bpm/60*Math.PI*2/64:.12),i=Math.min(1.4,i*Math.exp(-w/2.5)+u.impulse.low*.28),e+=w,u.impulse.low>.35&&e>.12&&(e=0,o=Math.min(1,u.impulse.low*1.2));const h=.992-.008*g-.008*M;b+=(u.centroid-b)*(1-Math.exp(-w/1));let y=null,S=-1;for(const z of u.decks)z.level>S&&(S=z.level,y=z.trackId);y!==null&&y!==v&&(v=y,x=Da(y)),p+=(x-p)*(1-Math.exp(-w/2));const I=(b-.5)*.8,A=((p+I)%1+1)%1;return{u_time:u.time,u_low:u.bands.low,u_lowSlow:k.low,u_mid:u.bands.mid,u_midSlow:k.mid,u_high:u.bands.high,u_kick:u.impulse.low,u_snare:u.impulse.mid,u_centroid:u.centroid,u_specHue:b,u_hueRot:A,u_drop:C,u_buildup:M,u_zoom:P,u_rotStep:(.05+.5*k.mid+.5*M+.25*l)*_*w,u_decay:Math.min(.998,1-(1-h)/f),u_seed:Math.floor(u.time*20),u_rippleAge:e,u_rippleAmp:o,u_sustain:c,u_armPhase:r,u_charge:i,u_dust:(q=u.params.dust)!=null?q:1,u_palette:(O=u.params.palette)!=null?O:1,u_spawn:Math.min(1,1.15*u.impulse.high+.2*u.bands.high)*((W=u.params.stars)!=null?W:1)*(.4+.6*Math.max(C,c))/(1+1.8*M)/(1+2.2*u.impulse.low),u_spawnSnare:Math.min(1,.95*u.impulse.mid)*((F=u.params.stars)!=null?F:1)*(.5+.5*Math.max(C,c))/(1+.8*M)/(1+2.2*u.impulse.low)}}})}},Ha=160;class qa{constructor(){Y(this,"buffer",null);Y(this,"bufferCtx",null);Y(this,"rotation",0)}ensureBuffer(e,o){return(!this.buffer||this.buffer.width!==e||this.buffer.height!==o)&&(this.buffer=document.createElement("canvas"),this.buffer.width=e,this.buffer.height=o,this.bufferCtx=this.buffer.getContext("2d")),this.bufferCtx}render(e,o,r,a){var n,T;const s=this.ensureBuffer(o,r),{low:i,mid:b,high:p}=a.bands,x=o/2,v=r/2,u=Math.min(o,r);if(e.globalCompositeOperation="source-over",e.fillStyle="#000",e.fillRect(0,0,o,r),this.buffer&&s){const C=(n=a.params.zoom)!=null?n:1,M=1+(.3+1.4*i*i+3.5*a.impulse.low)*C*a.dt;this.rotation=(.1+1.2*b+1.8*a.impulse.mid)*a.dt,e.save(),e.translate(x,v),e.rotate(this.rotation),e.scale(M,M),e.globalAlpha=.9+.095*((T=a.params.trail)!=null?T:.68),e.drawImage(this.buffer,-x,-v),e.restore(),e.globalAlpha=1}e.globalCompositeOperation="lighter";const w=Pe(X(a.bands),a.time*6),g=u*(.1+.16*i),k=u*.02*b;e.beginPath();const d=64;for(let C=0;C<=d;C++){const M=C/d*Math.PI*2,c=g+Math.sin(M*6+a.time*3)*k,l=x+Math.cos(M)*c,m=v+Math.sin(M)*c;C===0?e.moveTo(l,m):e.lineTo(l,m)}e.closePath(),e.strokeStyle=`hsl(${w}, 100%, ${45+35*i}%)`,e.lineWidth=Math.max(2,u*(.004+.014*i)),e.stroke();const _=Ha*p*p*a.dt;let f=Math.floor(_)+(Math.random()<_%1?1:0);for(;f-- >0;){const C=Math.random()*Math.PI*2,M=g*(.9+Math.random()*.4),c=u*(.0015+.003*Math.random());e.fillStyle=`hsl(${(w+180+Math.random()*40)%360}, 100%, 75%)`,e.beginPath(),e.arc(x+Math.cos(C)*M,v+Math.sin(C)*M,c,0,Math.PI*2),e.fill()}e.globalCompositeOperation="source-over",s&&this.buffer&&(s.clearRect(0,0,o,r),s.drawImage(e.canvas,0,0))}}const za={id:"tunnel",name:"Tunnel",params:[{id:"trail",label:"trail length",min:0,max:1,step:.02,default:.68},{id:"zoom",label:"zoom drive",min:.3,max:2.5,step:.05,default:1}],create:()=>new qa},ht=t=>`vec3(${t[0].toFixed(3)}, ${t[1].toFixed(3)}, ${t[2].toFixed(3)})`,Wa=`
precision highp float;
uniform vec2 u_res;
uniform float u_time;
uniform float u_low;
uniform float u_mid;
uniform float u_high;
uniform float u_kick;
uniform float u_snare;
uniform float u_excite;  // drop excitement 0..1

const vec3 LOW = ${ht(re[0])};
const vec3 MID = ${ht(re[1])};
const vec3 HIGH = ${ht(re[2])};

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

float fbm(vec2 p) {
  float v = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 4; i++) {
    v += amp * noise(p);
    p = p * 2.03 + vec2(17.3, 9.1);
    amp *= 0.5;
  }
  return v;
}

// One curtain layer: vertical streaks whose brightness falls from the top,
// waving with fbm; higher detail adds fine shimmer.
float curtain(vec2 uv, float t, float speed, float scale, float detail, float level) {
  float wave = fbm(vec2(uv.x * scale + t * speed, t * 0.11));
  float ripple = u_snare * 0.25 * sin(uv.x * 40.0 + t * 9.0);
  // The band shapes the GEOMETRY: quiet band = a low flat veil, loud band
  // = tall swinging waves (brightness alone made all bands move together).
  float reach = 0.1 + 0.55 * level;
  float body = 1.0 - abs(uv.y - (0.1 + reach * wave + ripple));
  body = pow(max(0.0, body), 5.0 - 2.5 * level);
  float streaks = 0.6 + 0.4 * fbm(vec2(uv.x * (scale * 6.0 + detail * 22.0), uv.y * 2.0 - t * 0.35));
  return body * streaks;
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  uv.x *= u_res.x / u_res.y;
  float t = u_time;

  vec3 col = vec3(0.0);
  // Three curtains, one per band, each with its own drift and scale.
  col += LOW * curtain(uv, t, 0.05, 0.9, 0.0, u_low) * (0.2 + 1.3 * u_low);
  col += MID * curtain(uv + vec2(3.7, 0.04), t * 1.2, -0.07, 1.4, 0.2, u_mid) * (0.12 + 1.2 * u_mid);
  col += HIGH * curtain(uv + vec2(9.2, -0.03), t * 1.5, 0.1, 2.2, 1.0, u_high) * (0.08 + 1.2 * u_high);

  // Horizon flare: kicks light the ground line.
  float ground = exp(-abs(uv.y - 0.06) * 18.0);
  col += mix(LOW, vec3(1.0), 0.4) * ground * (0.1 + 0.9 * u_kick);

  // Star shimmer with the highs.
  float star = pow(hash(floor(uv * 220.0)), 40.0);
  col += vec3(0.8, 0.9, 1.0) * star * u_high * (0.5 + 0.5 * sin(t * 7.0 + uv.x * 90.0));

  // Drops raise the whole sky.
  col *= 0.65 + 0.6 * u_excite;
  gl_FragColor = vec4(min(col, vec3(1.0)), 1.0);
}
`,Oa={id:"aurora",hiRes:!0,name:"Aurora",create:()=>ue({fragment:Wa,uniforms:t=>({u_time:t.time,u_low:t.bands.low,u_mid:t.bands.mid,u_high:t.bands.high,u_kick:t.impulse.low,u_snare:t.impulse.mid,u_excite:.4*X(t.bands)+.6*t.trend.excitement})})},we=24,La=`
precision highp float;
uniform sampler2D u_prev;
uniform vec2 u_res;
uniform float u_time;
uniform float u_low;
uniform float u_mid;
uniform float u_high;
uniform float u_kick;
uniform float u_snare;
uniform float u_drop;
uniform float u_buildup;
uniform float u_sustain;
uniform float u_centroid;
uniform float u_decay;
uniform float u_seed;
uniform float u_dust;
uniform float u_palette;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

float fbm(vec2 p) {
  float v = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 4; i++) {
    v += amp * noise(p);
    p = p * 2.03 + vec2(17.3, 9.1);
    amp *= 0.5;
  }
  return v;
}

vec3 palette(float t) {
  vec3 a; vec3 b; vec3 cf; vec3 d;
  if (u_palette < 0.5) {
    a = vec3(0.42, 0.14, 0.1); b = vec3(0.42, 0.24, 0.14);
    cf = vec3(1.0, 0.9, 0.6); d = vec3(0.0, 0.15, 0.25);
  } else if (u_palette < 1.5) {
    a = vec3(0.45, 0.28, 0.42); b = vec3(0.25, 0.35, 0.5);
    cf = vec3(1.0, 0.85, 0.7); d = vec3(0.0, 0.2, 0.45);
  } else if (u_palette < 2.5) {
    a = vec3(0.12, 0.35, 0.3); b = vec3(0.2, 0.42, 0.38);
    cf = vec3(0.9, 1.0, 0.8); d = vec3(0.1, 0.3, 0.5);
  } else {
    a = vec3(0.5, 0.4, 0.25); b = vec3(0.42, 0.36, 0.28);
    cf = vec3(1.0, 1.0, 0.9); d = vec3(0.0, 0.1, 0.2);
  }
  return a + b * cos(6.28318 * (cf * t + d)) + vec3(0.12, -0.02, -0.06) * u_drop;
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  float aspect = u_res.x / u_res.y;
  vec2 c = (uv - 0.5) * vec2(aspect, 1.0);
  float r = length(c);
  float ang = atan(c.y, c.x);
  float t = u_time;

  // ---- Pressure warp: shells push OUTWARD (drop expands the medium),
  // accretion pulls INWARD during buildups; a slow churn keeps it alive.
  vec2 dir = r > 1e-4 ? c / r : vec2(0.0);
  float outward = (0.001 + 0.02 * u_drop + 0.05 * u_kick) * exp(-r * 1.2);
  float inward = 0.012 * u_buildup;
  vec2 churn = (vec2(fbm(c * 3.1 + t * 0.1), fbm(c * 3.1 + vec2(9.2, 4.4) - t * 0.08)) - 0.5)
    * (0.003 + 0.012 * u_mid);
  vec2 src = (c - dir * (outward - inward) + churn) / vec2(aspect, 1.0) + 0.5;
  vec3 medium = texture2D(u_prev, src).rgb * u_decay;

  // ---- The nebula medium (mids): density-churned, center-dark.
  float density = fbm(c * (2.2 + 1.2 * u_mid) + vec2(t * 0.05, -t * 0.04));
  float centerDim = smoothstep(0.03, 0.35, r);
  vec3 fresh = palette(density * 0.8 + u_centroid * 0.4 + t * 0.012)
    * pow(density, 2.0) * (0.1 + 1.1 * u_mid) * u_dust * centerDim * exp(-r * 1.4);
  // Coal core, whitening only when the drop ignites it.
  vec3 coal = vec3(0.55, 0.07, 0.04);
  float heart = exp(-r * r * 240.0);
  fresh += mix(coal, vec3(1.0, 0.95, 0.85), 0.6 * u_drop + 0.4 * u_kick)
    * heart * (0.5 + 1.3 * u_low + 1.6 * u_kick);
  // Electric crackle (highs): thin ridges arcing through the medium.
  float ridge = abs(fbm(vec2(ang * 4.0 + t * 0.4, r * 6.0 - t * 0.3)) - 0.5);
  float crackle = pow(max(0.0, 1.0 - ridge * 9.0), 6.0);
  fresh += mix(vec3(0.45, 0.9, 1.0), palette(0.65), 0.3) * crackle
    * smoothstep(0.1, 0.45, r) * (0.04 + 1.5 * u_high) * u_dust;
  // Accretion streaks (buildups): the medium falling inward.
  float streaks = pow(fbm(vec2(ang * 9.0, r * 2.5 + t * 0.9)), 4.0);
  fresh += palette(0.3 + t * 0.02) * streaks * u_buildup * exp(-r * 1.6) * 0.9;
  medium += fresh * (1.0 - u_decay) * (3.0 + 1.8 * u_sustain);

  // ---- Stamps.
  // Kick shells: luminous rings living IN the medium, expanding forever.
  if (u_kick > 0.03) {
    float shell = exp(-pow((r - (0.09 + 0.04 * u_kick)) * 42.0, 2.0));
    medium += mix(coal, vec3(1.0, 0.85, 0.7), 0.5 + 0.3 * u_drop) * shell * u_kick * 1.1;
  }
  // Snare powder.
  if (u_snare > 0.03) {
    vec2 q = c * 17.0;
    vec2 cell = floor(q);
    vec2 sc = cell + vec2(fract(u_seed * 0.7131) * 61.7, fract(u_seed * 0.3719) * 43.1);
    vec2 pos = vec2(hash(sc + 1.3), hash(sc.yx + 4.7)) * 0.7 + 0.15;
    vec2 f = fract(q) - pos;
    float star = exp(-dot(f, f) * 380.0) * step(0.982, hash(sc * 1.618 + 9.7));
    medium += vec3(1.0, 0.95, 0.9) * star * u_snare * smoothstep(0.08, 0.2, r) * 1.4;
  }

  // Supernova lift on the drop; soft knee.
  medium *= 0.72 + 0.5 * max(u_drop, u_sustain) - 0.05 * u_buildup;
  float m = max(medium.r, max(medium.g, medium.b));
  if (m > 0.8) {
    medium *= (0.8 + 0.2 * (1.0 - exp(-(m - 0.8) * 3.0))) / m;
  }
  gl_FragColor = vec4(max(medium, 0.0), 1.0);
}
`,Ba={id:"nova",name:"Nova",hiRes:!0,params:[{id:"dust",label:"nebula density",min:0,max:2,step:.05,default:1},{id:"palette",label:"palette 0-3 (ember/nebula/aurora/solar)",min:0,max:3,step:1,default:0},{id:"persistence",label:"persistence",min:.5,max:2,step:.05,default:1}],create:()=>{let t=0,e=0,o=0;return ue({fragment:La,feedback:!0,uniforms:r=>{var v,u,w;const a=o>0?Math.min(.1,Math.max(0,r.time-o)):.016666666666666666;o=r.time;const s=X(r.bands),i=Math.min(1,Math.max(0,(r.bands.low-.2)/.5)),b=1-Math.exp(-a/.35);t+=(r.trend.excitement*i-t)*b,e+=(r.trend.excitement*(1-i)-e)*b;const p=(v=r.params.persistence)!=null?v:1,x=.99-.006*s;return{u_time:r.time,u_low:r.bands.low,u_mid:r.bands.mid,u_high:r.bands.high,u_kick:r.impulse.low,u_snare:r.impulse.mid,u_drop:t,u_buildup:e,u_sustain:Math.min(1,s*1.4),u_centroid:r.centroid,u_decay:Math.min(.998,1-(1-x)/p),u_seed:Math.floor(r.time*20),u_dust:(u=r.params.dust)!=null?u:1,u_palette:(w=r.params.palette)!=null?w:0}}})}},pt=t=>`vec3(${t[0].toFixed(3)}, ${t[1].toFixed(3)}, ${t[2].toFixed(3)})`,Na=`
precision highp float;
uniform vec2 u_res;
uniform float u_time;
uniform float u_low;
uniform float u_mid;
uniform float u_high;
uniform float u_energy;
uniform float u_kick;    // low impulse
uniform float u_snare;   // mid impulse
uniform float u_beat;    // beat phase 0..1 (-1 = no grid)
uniform float u_bar;     // bar phase 0..1 (-1 = no grid)

const vec3 LOW = ${pt(re[0])};
const vec3 MID = ${pt(re[1])};
const vec3 HIGH = ${pt(re[2])};
const float PI = 3.141592653589793;

void main() {
  vec2 uv = (gl_FragCoord.xy * 2.0 - u_res) / min(u_res.x, u_res.y);
  // Kick jolt: the whole field lunges toward the viewer on a transient.
  uv *= 1.0 - 0.12 * u_kick;
  float r = length(uv);
  float a = atan(uv.y, uv.x);

  float seg = (u_bar >= 0.5) ? 12.0 : 6.0;
  float fold = PI / seg;
  a = abs(mod(a + u_time * 0.07, 2.0 * fold) - fold);
  vec2 p = vec2(cos(a), sin(a)) * r;

  float t = u_time;
  float f1 = sin(p.x * 5.0 + t * 1.1) + sin((p.x + p.y) * 4.0 - t * 0.8);
  float lowGlow = (0.5 + 0.5 * sin(f1 * PI * 0.5 + r * 5.0 - t))
    * (1.0 - smoothstep(0.0, 0.85 + 0.5 * u_low, r));
  float f2 = sin(a * seg * 2.0 + r * (9.0 + 6.0 * u_mid) - t * (1.5 + 3.0 * u_mid));
  float midSwirl = pow(0.5 + 0.5 * f2, 3.0);
  float f3 = sin(r * (30.0 + 24.0 * u_high) - t * 6.0 + sin(a * seg * 4.0));
  float highGlint = pow(0.5 + 0.5 * f3, 6.0);

  vec3 col = vec3(0.0);
  col += LOW * lowGlow * (0.25 + 1.3 * u_low);
  col += MID * midSwirl * (0.1 + 1.1 * u_mid) * (1.0 - smoothstep(0.1, 1.2, r));
  col += HIGH * highGlint * (0.06 + 1.2 * u_high);

  if (u_beat >= 0.0) {
    float wave = exp(-45.0 * abs(r - (0.1 + u_beat * 1.1)));
    col += vec3(1.0) * wave * (1.0 - u_beat) * (0.35 + 0.65 * u_low);
  }
  // Snare flash: a brief white lift of the mid ring zone.
  col += MID * u_snare * 0.5 * (1.0 - smoothstep(0.2, 0.9, r));
  col += vec3(1.0) * u_kick * 0.12;

  col *= 1.0 - 0.45 * smoothstep(0.7, 1.5, r);
  col *= 0.75 + 0.5 * u_energy;
  gl_FragColor = vec4(min(col, vec3(1.0)), 1.0);
}
`,Ga={id:"plasma",hiRes:!0,name:"Plasma",create:()=>ue({fragment:Na,uniforms:t=>({u_time:t.time,u_low:t.bands.low,u_mid:t.bands.mid,u_high:t.bands.high,u_energy:X(t.bands),u_kick:t.impulse.low,u_snare:t.impulse.mid,u_beat:t.beat?t.beat.phase:-1,u_bar:t.beat?t.beat.barPhase:-1})})},$a=t=>{let e=Math.floor(Math.abs(t))+2654435769>>>0;return e=Math.imul(e^e>>>16,569420461)>>>0,e=Math.imul(e^e>>>15,1935289751)>>>0,e=(e^e>>>15)>>>0,e/4294967296},Ua=`
precision highp float;
uniform sampler2D u_prev;
uniform vec2 u_res;
uniform float u_time;
uniform float u_low;
uniform float u_lowSlow;     // motion-grade low: gravity-wave phase rate (erratic-motion law)
uniform float u_mid;
uniform float u_midSlow;     // motion-grade mid: churn/warp rate (erratic-motion law)
uniform float u_high;
uniform float u_kick;
uniform float u_snare;
uniform float u_drop;
uniform float u_buildup;
uniform float u_sustain;
uniform float u_centroid;
uniform float u_decay;
uniform float u_seed;
uniform float u_spawn;      // high-transient nebula puffs
uniform float u_spawnSnare; // snare star powder
uniform float u_zoom;
uniform float u_rotStep;    // signed (genome spin)
uniform float u_charge;     // bass-ring charge
uniform float u_rippleAge;
uniform float u_rippleAmp;
uniform float u_palette;    // genome palette (continuous)
uniform float u_arms;       // genome arm count (eased)
uniform float u_fold;       // kaleidoscope segments (0 = unfolded)
uniform float u_horizonScale;
uniform float u_flash;      // mutation flash
uniform float u_phrase;     // phrase phase 0..1
uniform float u_section;    // section phase 0..1
uniform float u_barWave;    // bar-boundary wave age
uniform float u_beatPump;
uniform float u_dust;

const float PI = 3.141592653589793;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

float fbm(vec2 p) {
  float v = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 4; i++) {
    v += amp * noise(p);
    p = p * 2.03 + vec2(17.3, 9.1);
    amp *= 0.5;
  }
  return v;
}

vec3 pal0(float t) { return vec3(0.42, 0.14, 0.1) + vec3(0.42, 0.24, 0.14) * cos(6.28318 * (vec3(1.0, 0.9, 0.6) * t + vec3(0.0, 0.15, 0.25))); }
vec3 pal1(float t) { return vec3(0.45, 0.28, 0.42) + vec3(0.25, 0.35, 0.5) * cos(6.28318 * (vec3(1.0, 0.85, 0.7) * t + vec3(0.0, 0.2, 0.45))); }
vec3 pal2(float t) { return vec3(0.14, 0.36, 0.32) + vec3(0.3, 0.5, 0.45) * cos(6.28318 * (vec3(0.9, 1.0, 0.8) * t + vec3(0.1, 0.3, 0.5))); }
vec3 pal3(float t) { return vec3(0.5, 0.38, 0.24) + vec3(0.48, 0.42, 0.34) * cos(6.28318 * (vec3(1.0, 0.9, 0.8) * t + vec3(0.0, 0.12, 0.25))); }

vec3 palette(float t) {
  float x = clamp(u_palette, 0.0, 3.0);
  vec3 c = mix(pal0(t), pal1(t), clamp(x, 0.0, 1.0));
  c = mix(c, pal2(t), clamp(x - 1.0, 0.0, 1.0));
  c = mix(c, pal3(t), clamp(x - 2.0, 0.0, 1.0));
  return c + vec3(0.1, -0.02, -0.05) * u_drop - vec3(0.06, 0.02, -0.04) * u_buildup;
}

float starShape(vec2 f, float size) {
  float d2 = dot(f, f);
  float core = exp(-d2 * 1100.0 / size);
  float halo = exp(-d2 * 140.0 / size) * 0.2;
  float spikes = (exp(-abs(f.x) * 190.0 / size) * exp(-abs(f.y) * 16.0 / size)
    + exp(-abs(f.y) * 190.0 / size) * exp(-abs(f.x) * 16.0 / size)) * 0.55;
  return core + halo + spikes;
}

vec3 starScatter(vec2 c, float density, float sizeScale, float gate, float gain) {
  vec2 q = c * density;
  vec2 cell = floor(q);
  vec2 sc = cell + vec2(fract(u_seed * 0.7131) * 61.7, fract(u_seed * 0.3719) * 43.1);
  vec2 pos = vec2(hash(sc + 1.3), hash(sc.yx + 4.7)) * 0.7 + 0.15;
  vec2 f = fract(q) - pos;
  float on = step(gate - 0.09 * gain, hash(sc * 1.618 + 9.7));
  float size = (0.5 + 1.5 * hash(sc.yx * 2.113)) * sizeScale;
  float bright = 0.4 + 0.6 * hash(sc + 17.9);
  vec3 tint = mix(vec3(0.65, 0.78, 1.0), vec3(1.0, 0.85, 0.6), hash(sc.yx + 29.3));
  return tint * starShape(f, size) * on * bright * gain;
}

uniform float u_hueRot; // fringe fix: per-song hue anchor + slow spectral travel, TURNS 0..1

// fringe fix: value-preserving hue ROTATION in YIQ chroma-plane (dust-v3
// idiom). rot is in TURNS; luminance (Y) is untouched by construction.
vec3 hueRotate(vec3 c, float rot) {
  float y = dot(c, vec3(0.299, 0.587, 0.114));
  float i = dot(c, vec3(0.596, -0.274, -0.322));
  float q = dot(c, vec3(0.211, -0.523, 0.312));
  float h = atan(q, i) + rot * 6.28318;
  float chroma = sqrt(i * i + q * q);
  i = chroma * cos(h);
  q = chroma * sin(h);
  return max(vec3(0.0), vec3(
    y + 0.956 * i + 0.621 * q,
    y - 0.272 * i - 0.647 * q,
    y - 1.106 * i - 1.703 * q
  ));
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  float aspect = u_res.x / u_res.y;
  vec2 c = (uv - 0.5) * vec2(aspect, 1.0);
  float r = length(c);
  float ang = atan(c.y, c.x);
  float t = u_time;
  vec2 px = 1.0 / u_res;
  float anticipation = smoothstep(0.7, 1.0, u_phrase);

  // ---- Section fold on the warp coords: the accumulated universe folds.
  vec2 wc = c;
  if (u_fold > 0.5) {
    float fold = PI / u_fold;
    float fa = abs(mod(ang + t * 0.02, 2.0 * fold) - fold);
    wc = vec2(cos(fa), sin(fa)) * r;
  }

  // ---- Warp: differential rotation + churn + kick ripple + lens.
  float rot = u_rotStep * (0.35 + 1.4 * exp(-r * 2.2));
  float cs = cos(rot);
  float sn = sin(rot);
  vec2 w = mat2(cs, -sn, sn, cs) * wc / u_zoom;
  vec2 dirW = r > 1e-4 ? c / r : vec2(0.0);
  vec2 churn = (vec2(
    fbm(c * 2.6 + t * 0.12),
    fbm(c * 2.6 + vec2(7.7, 3.1) - t * 0.09)
  ) - 0.5) * (0.002 + 0.018 * u_midSlow + 0.012 * u_buildup + 0.006 * u_phrase + 0.006 * anticipation);  // motion: slow bands (erratic-motion law)
  float waveFront = 0.16 + u_rippleAge * 0.9;
  float rippleWave = exp(-pow((r - waveFront) * 9.0, 2.0)) * exp(-u_rippleAge * 2.4) * u_rippleAmp;
  vec2 ripple = dirW * rippleWave * 0.035;
  float barFront = 0.15 + u_barWave * 1.1;
  float barWave = exp(-pow((r - barFront) * 10.0, 2.0)) * exp(-u_barWave * 3.0);
  float horizon = (0.14 + 0.1 * u_low) * u_horizonScale * (1.0 + 0.07 * u_charge)
    * (1.0 + 0.04 * u_phrase * sin(t * 2.3));
  float lens = (0.3 * u_low + 1.15 * u_kick) * (1.0 + 0.7 * u_charge) * exp(-pow(r / horizon, 2.0) * 1.4);
  float drag = lens * 0.12;
  float dcs = cos(drag);
  float dsn = sin(drag);
  w = mat2(dcs, -dsn, dsn, dcs) * w;
  vec2 src = (w + churn + ripple + dirW * barWave * 0.02 + dirW * lens * 0.045)
    / vec2(aspect, 1.0) + 0.5;

  // Aberration + unsharp feedback sample.
  vec2 ab = dirW * (0.0012 + 0.004 * u_drop + 0.003 * u_kick + 0.01 * rippleWave + 0.006 * u_flash)
    / vec2(aspect, 1.0);
  ab *= u_dust; // fringe amount rides the dust param (human note)
  // fringe fix: hue-steerable fringes -- rotate the field to the anchor
  // frame, split channels there, rotate back. Clamped >= 0 (hueRotate can
  // go slightly negative) so the unsharp feedback loop stays stable.
  float fringeRot = 0.0; // CLASSIC red/blue aberration fluid (human: keep some presets classic)
  vec3 tapA = texture2D(u_prev, src + ab).rgb;
  vec3 tapC = texture2D(u_prev, src).rgb;
  vec3 tapB = texture2D(u_prev, src - ab).rgb;
  vec3 sampled = max(vec3(0.0), hueRotate(vec3(
    hueRotate(tapA, -fringeRot).r,
    hueRotate(tapC, -fringeRot).g,
    hueRotate(tapB, -fringeRot).b
  ), fringeRot));
  vec3 blur = (texture2D(u_prev, src + vec2(px.x, 0.0)).rgb
    + texture2D(u_prev, src - vec2(px.x, 0.0)).rgb
    + texture2D(u_prev, src + vec2(0.0, px.y)).rgb
    + texture2D(u_prev, src - vec2(0.0, px.y)).rgb) * 0.25;
  vec3 sky = max(vec3(0.0), sampled * 1.35 - blur * 0.35) * u_decay;

  // ---- Fresh layers (voyage's stack + genome/phrase evolution).
  vec3 fresh = vec3(0.0);
  float volt = (noise(vec2(ang * 14.0 + t * 3.0, t * 22.0)) - 0.5)
    + 0.5 * (noise(vec2(ang * 30.0 - t * 5.0, t * 37.0)) - 0.5);
  float bassWarp = u_low * (0.2 * sin(ang * 3.0 + t * 1.7) + 0.13 * sin(ang * 5.0 - t * 2.3))
    + 0.16 * u_kick * sin(ang * 7.0 + t * 9.0)
    + volt * (0.14 * u_low + 0.32 * u_kick);
  float rc = r * (1.0 - bassWarp * exp(-r * 3.0));
  float centerDim = smoothstep(horizon * 0.45, horizon * 1.2, r);
  vec3 coal = vec3(0.55, 0.07, 0.04);
  float heart = exp(-rc * rc * (260.0 - 130.0 * u_kick));
  fresh += mix(coal, vec3(1.0, 0.8, 0.7), 0.5 * u_kick) * heart * (0.5 + 1.2 * u_low + 1.4 * u_kick);
  // motion: slow bands (erratic-motion law) — gravity-wave travel rate
  float gravity = sin(rc * 46.0 - t * (3.0 + 9.0 * u_lowSlow)) * 0.5 + 0.5;
  fresh += mix(coal, vec3(0.9, 0.25, 0.12), 0.5) * pow(gravity, 4.0) * exp(-r * 5.0)
    * u_low * (0.5 + 0.8 * u_kick);
  // Charged horizon ring (evolution: brightens through the phrase).
  float arcJitter = volt * (0.012 + 0.05 * u_kick + 0.022 * u_low);
  float ringGlow = exp(-pow((r - horizon - arcJitter) * 52.0, 2.0));
  float ringCore = exp(-pow((r - horizon - arcJitter) * 210.0, 2.0));
  vec3 chargeColor = mix(vec3(0.9, 0.2, 0.1), vec3(1.0, 0.75, 0.4), clamp(u_charge, 0.0, 1.0));
  chargeColor = mix(chargeColor, vec3(1.0, 0.97, 0.92), clamp(u_charge - 0.6, 0.0, 0.4) * 2.5);
  float ringGain = 1.0 + 0.5 * anticipation;
  fresh += chargeColor * ringGlow * (0.12 + 0.6 * u_low + 1.1 * u_kick + 0.5 * u_charge) * ringGain;
  fresh += mix(chargeColor, vec3(1.0), 0.5 * u_kick) * ringCore
    * (0.3 + 1.3 * smoothstep(0.06, 0.3, u_low) + 2.4 * u_kick + 0.8 * u_charge) * ringGain;
  // Lens streak.
  float streak = exp(-abs(c.y) * 110.0) * exp(-abs(c.x) * (4.5 - 1.5 * u_drop));
  fresh += mix(vec3(0.6, 0.75, 1.0), palette(t * 0.02), 0.65) * streak
    * (0.25 + 1.2 * u_low + 0.8 * u_kick);
  // Dust disk: genome arms, twist TIGHTENS through the phrase, dust
  // swells toward the boundary; bar waves light it as they pass.
  float twist = 4.5 + 2.5 * u_phrase;
  float arm = sin(ang * u_arms + log(r + 0.06) * twist - t * (0.06 + 0.14 * u_phrase)
    + 0.5 * u_mid * sin(ang * 3.0 + r * 6.0 + t * 0.7));
  float lanes = pow(0.5 + 0.5 * arm, 3.0) * smoothstep(0.06, 0.2, r) * exp(-r * 1.8);
  float cloudField = fbm(vec2(ang * 2.2 + r * 3.0 - t * 0.15, r * 5.0 + t * 0.06));
  float cloud = pow(cloudField, 2.4);
  // Palette phase slides across the phrase too — color creeps, then
  // the boundary jump lands somewhere genuinely new.
  vec3 diskColor = palette(cloudField * 1.5 + r * 0.35 + ang * 0.1 + u_centroid * 0.4 + u_phrase * 0.35);
  float reverb = 1.0 + 2.6 * rippleWave + 2.2 * barWave;
  float midGate = smoothstep(0.04, 0.3, u_mid);
  float dustSwell = u_dust * (0.75 + 0.5 * u_phrase);
  fresh += diskColor * lanes * (0.1 + 1.05 * u_mid) * (0.5 + cloud) * dustSwell * centerDim * midGate * reverb;
  fresh += diskColor * cloud * exp(-r * 2.4) * u_mid * 0.45 * dustSwell * centerDim * midGate * reverb;
  // Electric high nebula + shimmer.
  float wisp = fbm(vec2(ang * 6.0 - t * 0.5, r * 10.0 + t * 0.25));
  float shimmer = 0.6 + 0.4 * sin(t * 13.0 + wisp * 24.0);
  vec3 electric = mix(vec3(0.4, 0.9, 1.0), palette(0.6 + t * 0.03), 0.65);
  fresh += electric * pow(wisp, 3.2) * shimmer * smoothstep(0.12, 0.5, r)
    * (0.06 + 1.45 * u_high) * u_dust * reverb;
  // Section omen: a ring closing in from the screen edge over the last bars.
  float omen = smoothstep(0.8, 1.0, u_section);
  if (omen > 0.001) {
    float omenR = 1.15 - 0.75 * omen;
    fresh += palette(0.5) * exp(-pow((r - omenR) * 26.0, 2.0)) * omen * 0.8;
  }
  // Anticipation shimmer: the last bar of a phrase flickers.
  fresh *= 1.0 + 0.12 * anticipation * sin(t * 25.0);
  sky += fresh * (1.0 - u_decay) * (3.0 + 1.2 * u_sustain);

  // ---- Stamps.
  if (u_spawn > 0.01) {
    vec2 sOff = vec2(fract(u_seed * 0.7131) * 21.7, fract(u_seed * 0.3719) * 13.1);
    float puff = pow(fbm(c * 7.0 + sOff), 3.5);
    sky += electric * puff * smoothstep(0.1, 0.4, r) * u_spawn * 0.9;
  }
  if (u_spawnSnare > 0.003) {
    sky += starScatter(c + 11.3, 16.0, 2.8, 0.984, u_spawnSnare * 1.2)
      * smoothstep(0.05, 0.18, r) * mix(vec3(1.0), palette(0.15), 0.45);
  }
  if (u_kick > 0.02) {
    float ringR = 0.1 + 0.05 * u_kick;
    float shock = exp(-pow((r - ringR) * 38.0, 2.0))
      + 0.6 * exp(-pow((r - ringR * 1.7) * 30.0, 2.0));
    sky += mix(coal, vec3(1.0, 0.9, 0.8), 0.6) * shock * u_kick * (1.15 + 0.8 * u_drop);
    sky *= 1.0 + 0.1 * u_kick;
  }

  // Mutation flash, grain, grade, dynamics, knee.
  sky += palette(0.4) * u_flash * 0.24 * (1.0 - smoothstep(0.0, 0.9, r));
  sky += (hash(gl_FragCoord.xy + fract(t) * 191.0) - 0.5) * (0.012 + 0.02 * u_drop);
  vec3 grade = palette(0.35 + u_centroid * 0.2);
  sky = mix(sky, sky * (0.4 + grade * 1.5), 0.24);
  sky *= (0.7 + 0.38 * max(u_drop, u_sustain) - 0.05 * u_buildup) * (1.0 + 0.06 * u_beatPump);
  float m = max(sky.r, max(sky.g, sky.b));
  if (m > 0.8) {
    sky *= (0.8 + 0.2 * (1.0 - exp(-(m - 0.8) * 3.0))) / m;
  }
  gl_FragColor = vec4(max(sky, 0.0), 1.0);
}
`,dt=[2,3,5],Bt=[0,6,8],Ka=3,Va={id:"odyssey",name:"Odyssey",hiRes:!0,params:[{id:"dust",label:"dust amount",min:0,max:2,step:.05,default:1},{id:"speed",label:"flight speed",min:.2,max:2.5,step:.05,default:1},{id:"chaos",label:"mutation chaos",min:0,max:2,step:.05,default:1}],create:()=>{let t=.5,e=0,o=0,r=null,a=Math.floor(Math.random()*4),s=a,i=0,b=dt[0],p=0,x=0,v=0,u=1,w=1,g=1,k=0,d=99,_=null,f=0,n=999,T=0,C=0,M=0,c=0,l=-99,m=0,P=0;return ue({fragment:Ua,feedback:!0,uniforms:h=>{var se,ie,ne,pe,fe;const y=P>0?Math.min(.1,Math.max(0,h.time-P)):.016666666666666666;P=h.time;const S=X(h.bands),I=(se=h.bandsSlow)!=null?se:h.bands,A=X(I),E=h.beat,R=(ie=h.params.chaos)!=null?ie:1,D=Math.min(1,Math.max(0,(h.bands.low-.2)/.5)),H=1-Math.exp(-y/.35);C+=(h.trend.excitement*D-C)*H,M+=(h.trend.excitement*(1-D)-M)*H;const q=Math.min(1,S*1.4),O=Math.min(1,A*1.4),W=Math.max(C,.7*O);C>.45&&c<=.45&&h.time-l>8&&(l=h.time,x=0,p=0,a=(a+2)%4,w=1.2,k=Math.min(1.4,1.2*R)),c=C,S<.15?m+=y:m=0,m>2.5&&x!==2&&(x=2,p=0,k=Math.max(k,.25*R));const F=E?(ne=E.ladderBarIndex)!=null?ne:E.barIndex:null;if(E&&F!==null){if(_!==null&&F!==_){d=0;const ce=(F%4+4)%4===0,ge=(F%16+16)%16===0;ce&&(a=(a+1)%4,i=(i+1)%dt.length,k=Math.max(k,.6*R)),ge&&(W>.5?(x=0,p=1+Math.floor(Math.random()*2)):(x=(x+1)%Ka,p=(p+1)%Bt.length),u*=-1,w=1+(Math.random()-.35)*.6*R,k=Math.min(1.4,1*R))}_=F}else _=null;const z=1-Math.exp(-y/.9),L=1-Math.exp(-y/.4);s+=(a-s)*z,b+=(dt[i]-b)*L,v+=(x-v)*z,g+=(w-g)*L,k=Math.max(0,k-y*1.4),d+=y,f=Math.min(1.4,f*Math.exp(-y/2.5)+h.impulse.low*.28),n+=y,h.impulse.low>.35&&n>.12&&(n=0,T=Math.min(1,h.impulse.low*1.2));const N=(pe=h.params.speed)!=null?pe:1,G=Math.max(0,1-Math.abs(v)),U=Math.max(0,1-Math.abs(v-1)),B=Math.max(0,1-Math.abs(v-2)),K=E&&F!==null?((F%4+4)%4+E.barPhase)/4:0,ae=1+(.08+.7*W+3.6*h.impulse.low*(.5+.5*W))*(.85+.3*K)*N*y,J=1-(.04+.25*A)*N*y+2.2*h.impulse.low*N*y*.5,te=1+.5*h.impulse.low*N*y,V=(.05+.5*I.mid+.25*O)*N*y,le=K,j=E&&F!==null?((F%16+16)%16+E.barPhase)/16:0;t+=(h.centroid-t)*(1-Math.exp(-y/1));let $=null,oe=-1;for(const ce of h.decks)ce.level>oe&&(oe=ce.level,$=ce.trackId);return $!==null&&$!==r&&(r=$,o=$a($)),e+=(o-e)*(1-Math.exp(-y/2)),{u_hueRot:((e+(t-.5)*.8)%1+1)%1,u_time:h.time,u_low:h.bands.low,u_lowSlow:I.low,u_mid:h.bands.mid,u_midSlow:I.mid,u_high:h.bands.high,u_kick:h.impulse.low,u_snare:h.impulse.mid,u_drop:C,u_buildup:M,u_sustain:q,u_centroid:h.centroid,u_decay:Math.min(.998,.992-.008*S-.008*M),u_seed:Math.floor(h.time*20),u_spawn:Math.min(1,1.15*h.impulse.high+.2*h.bands.high)*(.4+.6*Math.max(C,q))/(1+1.8*M)/(1+2.2*h.impulse.low),u_spawnSnare:Math.min(1,.95*h.impulse.mid)*(.5+.5*Math.max(C,q))/(1+.8*M)/(1+2.2*h.impulse.low),u_zoom:G*ae+U*J+B*te,u_rotStep:u*V*(1+2.2*B),u_charge:f,u_rippleAge:n,u_rippleAmp:T,u_palette:s,u_arms:b,u_fold:Bt[p],u_horizonScale:g,u_flash:k,u_phrase:le,u_section:j,u_barWave:d,u_beatPump:E?Math.pow(1-E.phase,2):0,u_dust:(fe=h.params.dust)!=null?fe:1}}})}},ja=`
precision highp float;
uniform sampler2D u_prev;
uniform vec2 u_res;
uniform float u_time;
uniform float u_dt;
uniform float u_energy;
uniform float u_kick;
uniform float u_hue;
uniform float u_decay;
uniform float u_flow;
uniform float u_spectrum[${we}];

const float BANDS = ${we}.0;

vec3 hsl2rgb(float h, float s, float l) {
  float c = (1.0 - abs(2.0 * l - 1.0)) * s;
  float hp = mod(h / 60.0, 6.0);
  float x = c * (1.0 - abs(mod(hp, 2.0) - 1.0));
  vec3 rgb = hp < 1.0 ? vec3(c, x, 0.0) : hp < 2.0 ? vec3(x, c, 0.0)
    : hp < 3.0 ? vec3(0.0, c, x) : hp < 4.0 ? vec3(0.0, x, c)
    : hp < 5.0 ? vec3(x, 0.0, c) : vec3(c, 0.0, x);
  return rgb + (l - c * 0.5);
}

float bandAt(float i) {
  float v = 0.0;
  for (int k = 0; k < ${we}; k++) {
    if (float(k) == i) v = u_spectrum[k];
  }
  return v;
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  vec2 centered = uv - 0.5;

  // Advection: silk flows away from the center axis, swaying with a curl
  // field; louder = faster weave.
  float away = sign(centered.y + 1e-5);
  float flow = (0.03 + 0.12 * u_energy) * u_flow * away;
  float sway = 0.012 * sin(centered.y * 26.0 + u_time * 0.8 + sin(uv.x * 21.0 + u_time * 0.5));
  vec2 src = uv - vec2(sway, flow) * u_dt * 6.0;
  vec3 silk = texture2D(u_prev, src).rgb * u_decay;

  // Emitters: 24 mirrored columns glowing on the axis with their band.
  float mx = clamp(abs(centered.x) * 2.2, 0.0, 0.999);
  float bandIndex = floor(mx * BANDS);
  float level = bandAt(bandIndex);
  float segCenter = (bandIndex + 0.5) / BANDS / 2.2;
  float dx = (abs(centered.x) - segCenter) * u_res.x / u_res.y;
  float d = length(vec2(dx * 2.0, centered.y * 3.0));
  float glow = level * exp(-d * d * 260.0);
  vec3 color = hsl2rgb(mod(u_hue + bandIndex * 3.0, 360.0), 1.0, 0.55 + 0.25 * level);
  silk += color * glow * (0.5 + 1.6 * level) / (1.0 + 1.4 * u_energy);

  // Kick: a bright pulse along the whole axis that the flow then weaves.
  silk += hsl2rgb(u_hue, 1.0, 0.75) * u_kick * exp(-abs(centered.y) * 40.0) * 0.35;

  // Soft knee above 0.8, scaling all channels together so hue survives
  // (per-channel min() bleached hot areas to white).
  float m = max(silk.r, max(silk.g, silk.b));
  if (m > 0.8) {
    silk *= (0.8 + 0.2 * (1.0 - exp(-(m - 0.8) * 3.0))) / m;
  }
  gl_FragColor = vec4(silk, 1.0);
}
`,Ya={id:"silk",hiRes:!0,name:"Silk",params:[{id:"flow",label:"flow speed",min:.3,max:2.5,step:.05,default:1},{id:"trail",label:"trail length",min:.5,max:1.5,step:.05,default:1}],create:()=>{let t=0;const e=new Float32Array(we);return ue({fragment:ja,feedback:!0,uniforms:o=>{var s,i;const r=t>0?Math.min(.1,Math.max(0,o.time-t)):.016666666666666666;t=o.time,e.set(o.spectrum.slice(0,we));const a=X(o.bands);return{u_time:o.time,u_dt:r,u_energy:a,u_kick:o.impulse.low,u_hue:Pe(a,o.time*3),u_decay:Math.min(.995,.976-.035*a+(((s=o.params.trail)!=null?s:1)-1)*.02),u_flow:(i=o.params.flow)!=null?i:1,u_spectrum:e}}})}},ft=t=>`vec3(${t[0].toFixed(3)}, ${t[1].toFixed(3)}, ${t[2].toFixed(3)})`,Nt=.7,Xa=.45,Ja=`
precision highp float;
uniform vec2 u_res;
uniform float u_time;
uniform float u_low;
uniform float u_mid;
uniform float u_high;
uniform float u_kick;
uniform float u_snare;
uniform float u_hat;
uniform float u_excite;
uniform float u_streak;      // shooting star progress 0..1 (>1 = none)
uniform float u_streakSeed;

const vec3 LOW = ${ft(re[0])};
const vec3 MID = ${ft(re[1])};
const vec3 HIGH = ${ft(re[2])};

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

float fbm(vec2 p) {
  float v = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 4; i++) {
    v += amp * noise(p);
    p = p * 2.03 + vec2(17.3, 9.1);
    amp *= 0.5;
  }
  return v;
}

// One parallax star layer: DRIFTING jittered stars with individual
// twinkle rates (fixed-grid stars read as a dead texture).
float starLayer(vec2 p, float density, float driftX, float t) {
  vec2 q = p * density + vec2(t * driftX, t * driftX * 0.13);
  vec2 cell = floor(q);
  vec2 pos = vec2(hash(cell + 1.3), hash(cell + 4.7)) * 0.8 + 0.1;
  vec2 f = fract(q) - pos;
  float star = exp(-dot(f, f) * 90.0);
  float gate = step(0.8, hash(cell + 9.3));
  float twinkle = 0.35 + 0.65 * (0.5 + 0.5 * sin(t * (2.0 + 5.0 * hash(cell + 2.2)) + hash(cell) * 40.0));
  return star * gate * twinkle;
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  float aspect = u_res.x / u_res.y;
  vec2 p = vec2(uv.x * aspect, uv.y);
  float t = u_time;
  vec3 col = vec3(0.0);

  // ---- LOW: the ground. Mass = bass level; kicks shake and flare it.
  float shake = u_kick * 0.006 * sin(t * 60.0);
  float ridgeH = 0.08 + 0.24 * u_low;
  float ridge = ridgeH * (0.4 + 0.6 * fbm(vec2(p.x * 2.2 + 3.0, t * 0.03))) + shake;
  float ground = smoothstep(ridge + 0.003, ridge - 0.02, uv.y);
  vec3 rock = LOW * (0.12 + 0.25 * u_low) * (0.4 + 0.6 * (1.0 - uv.y / max(ridge, 1e-3)));
  col += rock * ground;
  // Glowing veins crack the rock, breathing with the bass.
  float vein = smoothstep(0.46, 0.5, fbm(p * 7.0 + vec2(0.0, t * 0.05)))
    * smoothstep(0.54, 0.5, fbm(p * 7.0 + vec2(0.0, t * 0.05)));
  col += mix(LOW, vec3(1.0, 0.6, 0.3), 0.5) * vein * ground * (0.25 + 0.8 * u_low + 1.2 * u_kick);
  // Magma ridge line, flaring on the kick.
  float ridgeLine = exp(-abs(uv.y - ridge) * 160.0);
  col += mix(LOW, vec3(1.0, 0.85, 0.6), 0.35 * u_kick) * ridgeLine * (0.3 + 1.5 * u_kick + 0.4 * u_low);
  // Embers: two layers of sparks rising off the ridge, thicker on kicks.
  for (int layer = 0; layer < 2; layer++) {
    float fl = float(layer);
    float rise = t * (0.12 + 0.07 * fl);
    vec2 eq = vec2(p.x * (26.0 + 10.0 * fl) + fl * 31.0, (uv.y - ridge) * 22.0 - rise * 22.0);
    vec2 ecell = floor(eq);
    vec2 epos = vec2(hash(ecell + 3.1), hash(ecell + 6.9)) * 0.7 + 0.15;
    vec2 ef = fract(eq) - epos;
    float ember = exp(-dot(ef, ef) * 130.0) * step(0.75, hash(ecell + 12.7));
    float above = smoothstep(0.0, 0.02, uv.y - ridge) * exp(-(uv.y - ridge) * (9.0 - 4.0 * u_low));
    col += mix(LOW, vec3(1.0, 0.7, 0.35), 0.6) * ember * above * (0.25 + 0.8 * u_low + 1.6 * u_kick);
  }

  // ---- MID: the veil, two depths + light rays.
  float reach = 0.12 + 0.5 * u_mid;
  for (int layer = 0; layer < 2; layer++) {
    float fl = float(layer);
    float wave = fbm(vec2(p.x * (1.3 + 0.6 * fl) + t * (0.06 + 0.05 * fl) + fl * 11.0, t * 0.1));
    float rippleV = u_snare * 0.3 * sin(p.x * (36.0 + 14.0 * fl) + t * 10.0);
    float center = 0.45 + 0.08 * fl + reach * (wave - 0.5) + rippleV;
    float veil = pow(max(0.0, 1.0 - abs(uv.y - center) / (0.1 + 0.25 * u_mid)), 3.0);
    float fabric = 0.55 + 0.45 * fbm(vec2(p.x * (9.0 + 5.0 * fl), uv.y * 2.0 - t * 0.3));
    col += MID * veil * fabric * (0.08 + 1.1 * u_mid) * (1.0 - 0.4 * fl);
    // Light rays shafting DOWN from the veil (classic aurora curtains).
    float rayField = pow(fbm(vec2(p.x * (5.0 + 2.0 * fl) - t * (0.15 + 0.1 * fl), 0.5 + fl)), 3.0);
    float below = smoothstep(0.0, 0.05, center - uv.y) * exp(-(center - uv.y) * 5.0);
    col += MID * rayField * below * (0.15 + 1.4 * u_mid) * (1.0 - 0.4 * fl);
  }

  // ---- HIGH: the stars. Three drifting parallax depths, sky only.
  float sky = 1.0 - ground;
  float stars = starLayer(p, 60.0, 0.006, t) * 0.5
    + starLayer(p, 110.0, 0.012, t) * 0.8
    + starLayer(p, 190.0, 0.024, t);
  col += vec3(0.75, 0.85, 1.0) * stars * sky * (0.15 + 1.1 * u_high + 1.8 * u_hat);
  // High shimmer band near the top: fine noctilucent ripples.
  float shimmer = pow(fbm(vec2(p.x * 14.0 + t * 0.4, uv.y * 6.0 - t * 0.2)), 4.0);
  col += HIGH * shimmer * smoothstep(0.65, 0.95, uv.y) * u_high * 0.9;

  // Shooting star: launched by a strong high transient (JS-triggered).
  if (u_streak <= 1.0) {
    vec2 start = vec2(aspect * (0.15 + 0.7 * u_streakSeed), 0.9 - 0.2 * fract(u_streakSeed * 7.0));
    vec2 dir = normalize(vec2(0.8, -0.35));
    vec2 head = start + dir * u_streak * 0.6 * aspect;
    vec2 toPoint = p - head;
    float along = clamp(dot(toPoint, -dir), 0.0, 0.12);
    float d = length(toPoint + dir * along);
    float tail = exp(-d * 500.0) * exp(-along * 25.0);
    col += vec3(1.0) * tail * (1.0 - u_streak) * sky;
  }

  // Drops lift the whole sky; quiet sections sit dark.
  col *= 0.7 + 0.55 * u_excite;
  gl_FragColor = vec4(min(col, vec3(1.0)), 1.0);
}
`,Qa={id:"strata",hiRes:!0,name:"Strata",create:()=>{let t=-1/0,e=0;return ue({fragment:Ja,uniforms:o=>{const r=(o.time-t)/Nt;return o.impulse.high>Xa&&r>1.2&&(t=o.time,e=Math.random()),{u_time:o.time,u_low:o.bands.low,u_mid:o.bands.mid,u_high:o.bands.high,u_kick:o.impulse.low,u_snare:o.impulse.mid,u_hat:o.impulse.high,u_excite:.4*X(o.bands)+.6*o.trend.excitement,u_streak:Math.min(2,(o.time-t)/Nt),u_streakSeed:e}}})}},Za=`
precision highp float;
uniform vec2 u_res;
uniform float u_time;
uniform float u_z;        // accumulated flight depth
uniform float u_energy;
uniform float u_low;
uniform float u_kick;     // low impulse
uniform float u_hue;      // energy hue, degrees
uniform float u_spectrum[${we}];

const float PI = 3.141592653589793;
const float BANDS = ${we}.0;

vec3 hsl2rgb(float h, float s, float l) {
  float c = (1.0 - abs(2.0 * l - 1.0)) * s;
  float hp = mod(h / 60.0, 6.0);
  float x = c * (1.0 - abs(mod(hp, 2.0) - 1.0));
  vec3 rgb = hp < 1.0 ? vec3(c, x, 0.0) : hp < 2.0 ? vec3(x, c, 0.0)
    : hp < 3.0 ? vec3(0.0, c, x) : hp < 4.0 ? vec3(0.0, x, c)
    : hp < 5.0 ? vec3(x, 0.0, c) : vec3(c, 0.0, x);
  return rgb + (l - c * 0.5);
}

float bandAt(float i) {
  // Constant-index loop lookup (GLSL ES 1.0 has no dynamic array index).
  float v = 0.0;
  for (int k = 0; k < ${we}; k++) {
    if (float(k) == i) v = u_spectrum[k];
  }
  return v;
}

void main() {
  vec2 uv = (gl_FragCoord.xy * 2.0 - u_res) / min(u_res.x, u_res.y);
  // Inverted breathing: loud tightens the tube around you.
  uv *= 1.0 + 0.5 * u_energy;
  float r = length(uv);
  float angle = atan(uv.y, uv.x);

  // Tunnel coordinates: depth ~ 1/r, flying along +z.
  float depth = 0.35 / max(r, 1e-4) + u_z;
  // Gentle drift so the tube bends instead of staring down a pipe.
  angle += 0.35 * sin(depth * 0.22 + u_time * 0.15);

  // The spectrum wraps the wall: band by angle (mirrored), sub-glow by
  // how close this wall cell's ring is.
  float half_ = mod(angle / PI + 2.0, 2.0);           // 0..2
  float mirrored = half_ < 1.0 ? half_ : 2.0 - half_;  // 0..1, mirrored
  float bandIndex = floor(mirrored * (BANDS - 1.0) + 0.5);
  float level = bandAt(bandIndex);

  // Rings along the tube; each band bulges its wall cells inward.
  float ring = fract(depth * 0.5);
  float ringGlow = pow(1.0 - abs(ring - 0.5) * 2.0, 6.0 + 10.0 * (1.0 - level));
  float segEdge = pow(abs(fract(mirrored * (BANDS - 1.0)) - 0.5) * 2.0, 8.0);

  // Depth fog: far is dark.
  float fog = exp(-0.16 * (depth - u_z));

  float wall = ringGlow * (0.15 + 1.5 * level) + segEdge * 0.08 * level;
  vec3 base = hsl2rgb(u_hue, 1.0, 0.28 + 0.3 * level);
  vec3 rim = hsl2rgb(mod(u_hue + 180.0, 360.0), 1.0, 0.5);
  vec3 col = base * wall * fog;
  // Complementary rim breathing at the mouth.
  col += rim * pow(max(0.0, 1.0 - r), 3.0) * (0.12 + 0.5 * u_low);
  // Kick flash: the whole mouth blinks white on a low transient.
  col += vec3(1.0) * pow(max(0.0, 1.0 - r), 2.0) * u_kick * 0.7;

  gl_FragColor = vec4(min(col, vec3(1.0)), 1.0);
}
`,eo={id:"siphon",hiRes:!0,name:"Siphon",create:()=>{let t=0,e=0;const o=new Float32Array(we);return ue({fragment:Za,uniforms:r=>{const a=e>0?Math.max(0,r.time-e):.016666666666666666;e=r.time;const s=X(r.bands);return t+=a*(.6+2.4*r.trend.excitement+1.2*s),o.set(r.spectrum.slice(0,we)),{u_time:r.time,u_z:t,u_energy:s,u_low:r.bands.low,u_kick:r.impulse.low,u_hue:Pe(s),u_spectrum:o}}})}},mt={A:"#00e5ff",B:"#ff2d95",C:"#ff7a00",D:"#8f4dff"},to=.22,Gt=1.1,ao=160,oo=42,$t={A:-Math.PI/2,B:Math.PI/2,C:0,D:Math.PI};function ro(t){const e=parseInt(t.slice(1),16);return[e>>16&255,e>>8&255,e&255]}const Me=Object.fromEntries(Object.entries(mt).map(([t,e])=>[t,ro(e)]));function De(t,e,o=1){const r=a=>Math.min(255,Math.round(a*o));return`rgba(${r(t[0])}, ${r(t[1])}, ${r(t[2])}, ${e})`}class so{constructor(){Y(this,"phase",0);Y(this,"rings",[]);Y(this,"sparks",[]);Y(this,"dust",[]);Y(this,"prevBeatPhase",null);Y(this,"levels",new Map)}render(e,o,r,a){var T,C,M;const{low:s,mid:i,high:b}=a.bands,p=o/2,x=r/2,v=Math.min(o,r),u=[];for(const c of a.decks){const l=(T=this.levels.get(c.channel))!=null?T:0,m=c.level>l?.05:.35,P=1-Math.exp(-a.dt/m),h=l+(c.level-l)*P;this.levels.set(c.channel,h),h>.02&&u.push({...c,smooth:h})}const w=u.reduce((c,l)=>c+l.smooth,0),g=[...u].sort((c,l)=>l.smooth-c.smooth);let k=[4,4,8];for(const c of u){const l=c.smooth/Math.max(1e-4,w)*.09,m=Me[c.channel];k=[k[0]+m[0]*l,k[1]+m[1]*l,k[2]+m[2]*l]}const d=(C=a.params.trails)!=null?C:to;e.fillStyle=`rgba(${Math.round(k[0])}, ${Math.round(k[1])}, ${Math.round(k[2])}, ${d})`,e.fillRect(0,0,o,r),e.globalCompositeOperation="lighter",this.phase+=a.dt*(.25+1.6*i+.6*a.trend.excitement);const _=g.length>=2?Math.min(1,g[1].smooth/Math.max(1e-4,g[0].smooth)*1.2):0,f=g.length>=2&&g[0].trackId!==null&&g[0].trackId===g[1].trackId,n=new Map;for(const c of u){const l=c.smooth/Math.max(1e-4,w),m=v*(.05+.22*(1-l))*(u.length===1?0:1),P=this.phase*.35+$t[c.channel];n.set(c.channel,{x:p+Math.cos(P)*m,y:x+Math.sin(P)*m*.72})}for(const c of u){const l=n.get(c.channel),m=Me[c.channel],P=v*(.5+.3*c.smooth),h=e.createRadialGradient(l.x,l.y,0,l.x,l.y,P);h.addColorStop(0,De(m,.05+.09*c.smooth)),h.addColorStop(1,"rgba(0,0,0,0)"),e.fillStyle=h,e.fillRect(0,0,o,r)}if(this.dust.length===0)for(let c=0;c<oo;c++)this.dust.push({x:Math.random()*o,y:Math.random()*r,vx:(Math.random()-.5)*v*.02,vy:(Math.random()-.5)*v*.02,seed:Math.random()*Math.PI*2});for(const c of this.dust){c.x+=c.vx*a.dt*(1+2*b),c.y+=c.vy*a.dt*(1+2*b),c.x<0&&(c.x+=o),c.x>o&&(c.x-=o),c.y<0&&(c.y+=r),c.y>r&&(c.y-=r);const l=.4+.6*(.5+.5*Math.sin(a.time*2.5+c.seed*7));e.fillStyle=`rgba(${Math.round(k[0]*14)}, ${Math.round(k[1]*14)}, ${Math.round(k[2]*14)}, ${(.1+.35*b)*l})`,e.beginPath(),e.arc(c.x,c.y,Math.max(1,v*.0016*(1+b)),0,Math.PI*2),e.fill()}if(a.beat){if(this.prevBeatPhase!==null&&a.beat.phase<this.prevBeatPhase&&g.length>0){const c=(M=u.find(m=>m.channel===a.dominantChannel))!=null?M:g[0],l=f?[g[0],g[1]]:[c];for(const m of l){const P=n.get(m.channel);P&&this.rings.push({age:0,rgb:Me[m.channel],x:P.x,y:P.y})}}this.prevBeatPhase=a.beat.phase}else this.prevBeatPhase=null;this.rings=this.rings.filter(c=>{if(c.age+=a.dt,c.age>=Gt)return!1;const l=1-c.age/Gt;return e.beginPath(),e.arc(c.x,c.y,v*(.06+c.age*.4),0,Math.PI*2),e.strokeStyle=De(c.rgb,.5*l,1.2),e.lineWidth=Math.max(1.5,v*.008*l),e.stroke(),!0});for(const c of u){const l=n.get(c.channel),m=Me[c.channel],P=v*(.05+.14*c.smooth)*(1+.3*s*c.smooth+.5*a.impulse.low*c.smooth),h=e.createRadialGradient(l.x,l.y,0,l.x,l.y,P*2.6);h.addColorStop(0,De(m,.95,1.4)),h.addColorStop(.35,De(m,.5*c.smooth+.2)),h.addColorStop(1,"rgba(0,0,0,0)"),e.fillStyle=h,e.beginPath(),e.arc(l.x,l.y,P*2.6,0,Math.PI*2),e.fill();for(let y=0;y<3;y++){const S=this.phase*2.4+y/3*Math.PI*2+$t[c.channel],I=l.x+Math.cos(S)*P*1.5,A=l.y+Math.sin(S)*P*1.5;e.fillStyle=De(m,.35+.6*i,1.3),e.beginPath(),e.arc(I,A,Math.max(1.5,P*.09*(1+i)),0,Math.PI*2),e.fill()}}if(g.length>=2){const c=n.get(g[0].channel),l=n.get(g[1].channel);if(c&&l){const m=(30*_+140*a.impulse.high*_)*a.dt;let P=Math.floor(m)+(Math.random()<m%1?1:0);for(;P-- >0&&this.sparks.length<ao;){const h=Math.random(),y=[Me[g[0].channel][0]*(1-h)+Me[g[1].channel][0]*h,Me[g[0].channel][1]*(1-h)+Me[g[1].channel][1]*h,Me[g[0].channel][2]*(1-h)+Me[g[1].channel][2]*h];this.sparks.push({x:c.x+(l.x-c.x)*h,y:c.y+(l.y-c.y)*h,vx:(Math.random()-.5)*v*.12,vy:(Math.random()-.5)*v*.12-v*.03,age:0,rgb:y})}}}this.sparks=this.sparks.filter(c=>{if(c.age+=a.dt,c.age>=.6)return!1;c.x+=c.vx*a.dt,c.y+=c.vy*a.dt;const l=1-c.age/.6;return e.fillStyle=De(c.rgb,l,1.2),e.beginPath(),e.arc(c.x,c.y,Math.max(1,v*.0022*(1+l)),0,Math.PI*2),e.fill(),!0}),e.globalCompositeOperation="source-over"}}const io={id:"orbit",name:"Orbit",params:[{id:"trails",label:"trail wash (low = long)",min:.05,max:.4,step:.01,default:.22}],create:()=>new so},no=.55,Ut=1.4,lo=16,Kt=.82,co=10;class uo{constructor(){Y(this,"rings",[]);Y(this,"prevPhase",null);Y(this,"prevLow",0);Y(this,"rotation",0)}render(e,o,r,a){var m,P,h;const{low:s,mid:i,high:b}=a.bands,p=a.beat,x=X(a.bands),v=o/2,u=r/2,w=Math.min(o,r),g=(m=a.params.harmonic)!=null?m:.6,k=Pe(x,a.time*8+(a.centroid-.5)*160*g),d=.35+.65*a.trend.excitement;let _=!1;p?(this.prevPhase!==null&&p.phase<this.prevPhase&&(_=!0),this.prevPhase=p.phase):(this.prevPhase=null,this.prevLow<Kt&&s>=Kt&&(_=!0)),this.prevLow=s;const f=!!p&&p.beatInBar===0;_&&this.rings.length<lo&&this.rings.push({age:0,hue:(k+40)%360,strength:((f?.7:.3)+.5*a.impulse.low+.2*s)*d,downbeat:f});const n=p?p.beatInBar===0?1:.55:1,T=(p?Math.pow(1-p.phase,2):s*s)*n;e.fillStyle=`hsl(${k}, 100%, ${2+3*a.trend.slow+9*T*d}%)`,e.fillRect(0,0,o,r),e.globalCompositeOperation="lighter",this.rings=this.rings.filter(y=>{var R;if(y.age+=a.dt,y.age>=Ut)return!1;const S=1-y.age/Ut,I=y.downbeat?1.35:1,A=no*(.6+.8*d)*((R=a.params.ringSpeed)!=null?R:1),E=w*(.12+y.age*A*I);return e.beginPath(),e.arc(v,u,E,0,Math.PI*2),e.strokeStyle=`hsla(${y.hue}, 100%, ${y.downbeat?68:60}%, ${S*y.strength})`,e.lineWidth=Math.max(2,w*(y.downbeat?.02:.01)*S),e.stroke(),!0});const C=(P=p==null?void 0:p.beatsPerBar)!=null?P:4;if(p){this.rotation+=a.dt*.25*(1-d);let S=p.beatInBar/C*Math.PI*2-this.rotation%(Math.PI*2);S>Math.PI&&(S-=Math.PI*2),S<-Math.PI&&(S+=Math.PI*2),this.rotation+=S*Math.min(1,a.dt*co)*d}else this.rotation+=a.dt*.3;const c=(p?Math.pow(1-p.phase,3)*n:T)*(.2+.8*d)*((h=a.params.pump)!=null?h:1),l=w*(.1+.07*c+.05*s+.04*a.impulse.low);e.beginPath();for(let y=0;y<=C;y++){const S=-Math.PI/2+y/C*Math.PI*2+this.rotation,I=l*(1+.12*i*Math.sin(S*3+a.time*5)),A=v+Math.cos(S)*I,E=u+Math.sin(S)*I;y===0?e.moveTo(A,E):e.lineTo(A,E)}if(e.closePath(),e.strokeStyle=`hsl(${k}, 100%, ${50+40*c}%)`,e.lineWidth=Math.max(2,w*.006),e.stroke(),e.fillStyle=`hsla(${k}, 100%, 55%, ${.15+.35*c})`,e.fill(),a.impulse.mid>.05&&(e.strokeStyle=`rgba(255, 255, 255, ${.85*a.impulse.mid})`,e.lineWidth=Math.max(1.5,w*.003+w*.006*a.impulse.mid),e.stroke()),p){const y=l*1.6,S=(k+180)%360;e.beginPath(),e.arc(v,u,y,-Math.PI/2,-Math.PI/2+p.barPhase*Math.PI*2),e.strokeStyle=`hsla(${S}, 100%, ${60+30*b}%, 0.9)`,e.lineWidth=Math.max(2,w*.005),e.stroke();for(let I=0;I<p.beatsPerBar;I++){const A=-Math.PI/2+I/p.beatsPerBar*Math.PI*2,E=I===p.beatInBar,R=y-w*(E?.02:.012),D=y+w*(E?.02:.012);e.beginPath(),e.moveTo(v+Math.cos(A)*R,u+Math.sin(A)*R),e.lineTo(v+Math.cos(A)*D,u+Math.sin(A)*D),e.strokeStyle=E?`hsla(${S}, 100%, 80%, 1)`:`hsla(${S}, 100%, 60%, 0.45)`,e.lineWidth=Math.max(2,w*(E?.006:.003)),e.stroke()}}e.globalCompositeOperation="source-over"}}const ho={id:"pulse",name:"Pulse",params:[{id:"harmonic",label:"harmonic color",min:0,max:1.5,step:.05,default:.6},{id:"ringSpeed",label:"ring speed",min:.4,max:2,step:.05,default:1},{id:"pump",label:"pump depth",min:0,max:1.5,step:.05,default:1}],create:()=>new uo},po=1.6,Vt=[.35,.7,1];class fo{constructor(){Y(this,"bursts",[]);Y(this,"prevBar",null);Y(this,"hueJump",0);Y(this,"spinDirection",1);Y(this,"rotation",0);Y(this,"flash",0);Y(this,"whiteBloom",0)}render(e,o,r,a){var T,C,M,c;const{low:s,high:i}=a.bands,b=X(a.bands),p=a.beat,x=o/2,v=r/2,u=Math.min(o,r),w=Pe(b,this.hueJump+(a.centroid-.5)*80),g=p?(T=p.ladderBarIndex)!=null?T:p.barIndex:null,k=p&&g!==null?((g%4+4)%4+p.barPhase)/4:null,d=p&&g!==null?((g%16+16)%16+p.barPhase)/16:null;if(p&&g!==null){if(this.prevBar!==null&&g!==this.prevBar){const l=(g%4+4)%4===0,P=(g%16+16)%16===0?2:l?1:0;this.bursts.push({age:0,tier:P,hue:w}),P>=1&&(this.hueJump=(this.hueJump+45+45*P)%360,this.flash=Vt[P]),P===2&&(this.spinDirection*=-1,this.whiteBloom=1)}this.prevBar=g}else this.prevBar=null;if(this.flash=Math.max(0,this.flash-a.dt*1.8),this.whiteBloom=Math.max(0,this.whiteBloom-a.dt*1.2),this.rotation+=this.spinDirection*a.dt*(.15+.6*b),e.fillStyle=`hsl(${w}, 100%, ${2+5*b+14*this.flash}%)`,e.fillRect(0,0,o,r),e.globalCompositeOperation="lighter",this.whiteBloom>0){const l=e.createRadialGradient(x,v,0,x,v,u*.8);l.addColorStop(0,`rgba(255,255,255,${.35*this.whiteBloom})`),l.addColorStop(1,"rgba(0,0,0,0)"),e.fillStyle=l,e.fillRect(0,0,o,r)}const _=[{phase:(C=p==null?void 0:p.phase)!=null?C:null,radius:.16,weight:1,subdivisions:0},{phase:(M=p==null?void 0:p.barPhase)!=null?M:null,radius:.23,weight:1.4,subdivisions:(c=p==null?void 0:p.beatsPerBar)!=null?c:4},{phase:k,radius:.3,weight:2,subdivisions:4},{phase:d,radius:.37,weight:2.8,subdivisions:16}];for(let l=0;l<_.length;l++){const m=_[l],P=u*m.radius*(1+.05*s*(l===0?1:0));if(e.beginPath(),e.arc(x,v,P,0,Math.PI*2),e.strokeStyle=`hsla(${w}, 100%, 50%, 0.12)`,e.lineWidth=Math.max(1,u*.0022*m.weight),e.stroke(),m.phase===null)continue;if(m.subdivisions>1){const S=Math.min(m.subdivisions-1,Math.floor(m.phase*m.subdivisions));for(let I=0;I<m.subdivisions;I++){const A=-Math.PI/2+I/m.subdivisions*Math.PI*2,E=I===S,R=P-u*(E?.014:.006),D=P+u*(E?.014:.006);e.beginPath(),e.moveTo(x+Math.cos(A)*R,v+Math.sin(A)*R),e.lineTo(x+Math.cos(A)*D,v+Math.sin(A)*D),e.strokeStyle=`hsla(${(w+l*18)%360}, 100%, ${E?78:45}%, ${E?.95:.3})`,e.lineWidth=Math.max(1,u*(E?.005:.002)),e.stroke()}}const h=Math.max(0,(m.phase-.7)/.3),y=h*h*(3-2*h);e.beginPath(),e.arc(x,v,P,-Math.PI/2,-Math.PI/2+m.phase*Math.PI*2),e.strokeStyle=`hsla(${(w+l*18)%360}, 100%, ${55+30*y}%, ${.55+.45*y})`,e.lineWidth=Math.max(1.5,u*.004*m.weight*(1+.8*y)),e.stroke()}const f=p?Math.pow(1-p.phase,3):s*s,n=u*(.07+.03*f+.04*a.impulse.low+.02*s);if(e.save(),e.translate(x,v),e.rotate(this.rotation),e.strokeStyle=`hsl(${w}, 100%, ${52+35*f}%)`,e.lineWidth=Math.max(2,u*.006),e.strokeRect(-n,-n,n*2,n*2),e.fillStyle=`hsla(${w}, 100%, 55%, ${.12+.3*f})`,e.fillRect(-n,-n,n*2,n*2),e.restore(),this.bursts=this.bursts.filter(l=>{l.age+=a.dt;const m=1-l.age/po;if(m<=0)return!1;const P=Vt[l.tier];return e.beginPath(),e.arc(x,v,u*(.12+l.age*(.3+.35*P)),0,Math.PI*2),e.strokeStyle=l.tier===2?`rgba(255,255,255,${m*.9})`:`hsla(${l.hue}, 100%, 62%, ${m*(.4+.6*P)})`,e.lineWidth=Math.max(2,u*.016*P*m),e.stroke(),!0}),i>.05)for(let l=0;l<3;l++){const m=Math.random()*Math.PI*2,P=u*.37+(Math.random()-.5)*u*.02;e.fillStyle=`hsla(${(w+40)%360}, 100%, 75%, ${i*(.3+.5*a.impulse.high)})`,e.beginPath(),e.arc(x+Math.cos(m)*P,v+Math.sin(m)*P,Math.max(1,u*.002),0,Math.PI*2),e.fill()}e.globalCompositeOperation="source-over"}}const mo={id:"ladder",name:"Ladder",create:()=>new fo},jt=t=>"vec3("+t[0].toFixed(3)+", "+t[1].toFixed(3)+", "+t[2].toFixed(3)+")",go=t=>{let e=Math.floor(Math.abs(t))+2654435769>>>0;return e=Math.imul(e^e>>>16,569420461)>>>0,e=Math.imul(e^e>>>15,1935289751)>>>0,e=(e^e>>>15)>>>0,e/4294967296},_o=`precision highp float;
uniform sampler2D u_prev;
uniform vec2 u_res;
uniform float u_time;
uniform float u_low;
uniform float u_mid;
uniform float u_high;
uniform float u_kick;
uniform float u_snare;
uniform float u_centroid;
uniform float u_specHue;   // slow-tracked centroid (~1s EMA): dust hue follows spectral content
uniform float u_drop;
uniform float u_buildup;
uniform float u_zoom;
uniform float u_rotStep;
uniform float u_decay;
uniform float u_seed;
uniform float u_spawn;
uniform float u_rippleAge;
uniform float u_rippleAmp;
uniform float u_sustain;
uniform float u_armPhase;
uniform float u_dust;
uniform float u_palette;
uniform float u_charge;
uniform float u_spawnSnare;
uniform float u_phrase;    // in-phrase swell 0..1, released on downbeats
uniform float u_spread;    // spectral spread -> disk breadth
uniform float u_flatness;  // spectral flatness -> nebula texture
uniform float u_hueRot;    // DUST FIX v3: per-song hue anchor + slow travel, TURNS 0..1

const vec3 LOW = `+jt(re[0])+`;
const vec3 HIGH = `+jt(re[2])+`;

// DUST FIX v3: value-preserving hue ROTATION (YIQ chroma plane). rot in
// TURNS; luminance (Y) untouched so gains are unchanged. Negatives clamped.
vec3 hueRotate(vec3 c, float rot) {
  float y = dot(c, vec3(0.299, 0.587, 0.114));
  float i = dot(c, vec3(0.596, -0.274, -0.322));
  float q = dot(c, vec3(0.211, -0.523, 0.312));
  float h = atan(q, i) + rot * 6.28318;
  float chroma = sqrt(i * i + q * q);
  i = chroma * cos(h);
  q = chroma * sin(h);
  return max(vec3(0.0), vec3(
    y + 0.956 * i + 0.621 * q,
    y - 0.272 * i - 0.647 * q,
    y - 1.106 * i - 1.703 * q
  ));
}

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

float fbm(vec2 p) {
  float v = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 4; i++) {
    v += amp * noise(p);
    p = p * 2.03 + vec2(17.3, 9.1);
    amp *= 0.5;
  }
  return v;
}

// iq cosine palette: deep-space blues/violets/pinks that TRAVEL — phase
// rides time and the spectral centroid, warmth rides the drop.
vec3 pal0(float t) { return vec3(0.42, 0.14, 0.1) + vec3(0.42, 0.24, 0.14) * cos(6.28318 * (vec3(1.0, 0.9, 0.6) * t + vec3(0.0, 0.15, 0.25))); }
vec3 pal1(float t) { return vec3(0.45, 0.28, 0.42) + vec3(0.25, 0.35, 0.5) * cos(6.28318 * (vec3(1.0, 0.85, 0.7) * t + vec3(0.0, 0.2, 0.45))); }
vec3 pal2(float t) { return vec3(0.14, 0.36, 0.32) + vec3(0.3, 0.5, 0.45) * cos(6.28318 * (vec3(0.9, 1.0, 0.8) * t + vec3(0.1, 0.3, 0.5))); }
vec3 pal3(float t) { return vec3(0.5, 0.38, 0.24) + vec3(0.48, 0.42, 0.34) * cos(6.28318 * (vec3(1.0, 0.9, 0.8) * t + vec3(0.0, 0.12, 0.25))); }

// Branchless continuous palette: the slider MORPHS between the four
// (0 ember -> 1 nebula -> 2 aurora -> 3 solar) instead of switching.
vec3 palette(float t) {
  float x = clamp(u_palette, 0.0, 3.0);
  vec3 c = mix(pal0(t), pal1(t), clamp(x, 0.0, 1.0));
  c = mix(c, pal2(t), clamp(x - 1.0, 0.0, 1.0));
  c = mix(c, pal3(t), clamp(x - 2.0, 0.0, 1.0));
  return c + vec3(0.1, -0.02, -0.05) * u_drop - vec3(0.06, 0.02, -0.04) * u_buildup;
}

float starShape(vec2 f, float size) {
  float d2 = dot(f, f);
  float core = exp(-d2 * 1100.0 / size);
  float halo = exp(-d2 * 140.0 / size) * 0.2;
  float spikes = (exp(-abs(f.x) * 190.0 / size) * exp(-abs(f.y) * 16.0 / size)
    + exp(-abs(f.y) * 190.0 / size) * exp(-abs(f.x) * 16.0 / size)) * 0.55;
  return core + halo + spikes;
}

vec3 starScatter(vec2 c, float density, float sizeScale, float gate, float gain) {
  vec2 q = c * density;
  vec2 cell = floor(q);
  // Per-axis seed mixing: adding one scalar to both axes made the sin-hash
  // align stars into moire diagonals across the lattice.
  vec2 sc = cell + vec2(fract(u_seed * 0.7131) * 61.7, fract(u_seed * 0.3719) * 43.1);
  vec2 pos = vec2(hash(sc + 1.3), hash(sc.yx + 4.7)) * 0.7 + 0.15;
  vec2 f = fract(q) - pos;
  float on = step(gate - 0.09 * u_spawn, hash(sc * 1.618 + 9.7));
  float size = (0.5 + 1.5 * hash(sc.yx * 2.113)) * sizeScale;
  float bright = 0.4 + 0.6 * hash(sc + 17.9);
  // Star tint samples the traveling palette at each star own hash phase
  // (wide span) so the scatter picks up spectral color instead of a fixed
  // cool/warm ramp. Luminance unchanged.
  vec3 tint = palette(hash(sc.yx + 29.3) * 1.6 + u_time * 0.02);
  return hueRotate(mix(tint, HIGH, 0.2), u_hueRot) * starShape(f, size) * on * bright * gain;
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  float aspect = u_res.x / u_res.y;
  vec2 c = (uv - 0.5) * vec2(aspect, 1.0);
  float r = length(c);
  float ang = atan(c.y, c.x);
  float t = u_time;
  vec2 px = 1.0 / u_res;

  // ---- Warp: differential rotation + two NON-circular motions —
  // a turbulent churn field (mids knead the accumulated sky) and a
  // traveling kick ripple (each strong kick sends a displacement wave
  // through everything on screen, Tunnel-style physicality).
  // g02: the spiral twist TIGHTENS across the phrase (u_phrase 0->1) and
  // is released on the downbeat — a gentle in-phrase wind-up.
  float twist = 1.0 + 0.12 * u_phrase;
  float rot = u_rotStep * (0.35 + 1.4 * exp(-r * 2.2)) * twist;
  float cs = cos(rot);
  float sn = sin(rot);
  vec2 w = mat2(cs, -sn, sn, cs) * c / u_zoom;
  vec2 dirW = r > 1e-4 ? c / r : vec2(0.0);
  vec2 churn = (vec2(
    fbm(c * 2.6 + t * 0.12),
    fbm(c * 2.6 + vec2(7.7, 3.1) - t * 0.09)
  ) - 0.5) * (0.002 + 0.018 * u_mid + 0.012 * u_buildup);
  float waveFront = 0.16 + u_rippleAge * 0.9;
  float rippleWave = exp(-pow((r - waveFront) * 9.0, 2.0)) * exp(-u_rippleAge * 2.4) * u_rippleAmp;
  vec2 ripple = dirW * rippleWave * 0.035;
  // BLACK HOLE, localized: the event-horizon radius is the bass ring;
  // the lens lives INSIDE it (gaussian in r/horizon), so distortion churns
  // the interior while the field outside stays legible. Swirl is a hint,
  // not a whirlpool.
  float horizon = (0.14 + 0.1 * u_low) * (1.0 + 0.07 * u_charge);
  float lens = (0.4 * u_low + 1.5 * u_kick) * (1.0 + 0.9 * u_charge) * exp(-pow(r / horizon, 2.0) * 1.4);
  float drag = lens * 0.12;
  float dcs = cos(drag);
  float dsn = sin(drag);
  w = mat2(dcs, -dsn, dsn, dcs) * w;
  vec2 lensPull = dirW * lens * 0.055;
  vec2 src = (w + churn + ripple + lensPull) / vec2(aspect, 1.0) + 0.5;

  // Chromatic aberration: radial RGB split, widening through the drop
  // and blowing out along the ripple wavefront.
  vec2 ab = dirW * (0.0012 + 0.004 * u_drop + 0.003 * u_kick + 0.01 * rippleWave)
    / vec2(aspect, 1.0);
  ab *= u_dust; // fringe amount rides the dust param (human note)
  // fringe fix: hue-steerable fringes -- rotate the field to the anchor
  // frame, split channels there, rotate back. Clamped >= 0 (hueRotate can
  // go slightly negative) so the unsharp feedback loop stays stable.
  float fringeRot = 0.0;
  vec3 tapA = texture2D(u_prev, src + ab).rgb;
  vec3 tapC = texture2D(u_prev, src).rgb;
  vec3 tapB = texture2D(u_prev, src - ab).rgb;
  vec3 sampled = max(vec3(0.0), hueRotate(vec3(
    hueRotate(tapA, -fringeRot).r,
    hueRotate(tapC, -fringeRot).g,
    hueRotate(tapB, -fringeRot).b
  ), fringeRot));
  // Unsharp: the anti-mush pass — boost against a 4-tap blur so stars
  // and arms stay crisp through endless resampling.
  vec3 blur = (texture2D(u_prev, src + vec2(px.x, 0.0)).rgb
    + texture2D(u_prev, src - vec2(px.x, 0.0)).rgb
    + texture2D(u_prev, src + vec2(0.0, px.y)).rgb
    + texture2D(u_prev, src - vec2(0.0, px.y)).rgb) * 0.25;
  vec3 sky = max(vec3(0.0), sampled * 1.35 - blur * 0.35) * u_decay;

  // ---- Steady layers, injected at (1 - decay).
  vec3 fresh = vec3(0.0);
  // The bass circle stops being a circle: the low band kneads its rim
  // (two angular modes + a kick-synced tremor), so the core follows the
  // follows the bassline, not just its size.
  // Electrical vibration: two fast noise bands arcing around the rim —
  // the bass circle hums like a live wire, violently under a kick.
  float volt = (noise(vec2(ang * 14.0 + t * 3.0, t * 22.0)) - 0.5)
    + 0.5 * (noise(vec2(ang * 30.0 - t * 5.0, t * 37.0)) - 0.5);
  float bassWarp = u_low * (0.2 * sin(ang * 3.0 + t * 1.7) + 0.13 * sin(ang * 5.0 - t * 2.3))
    + 0.16 * u_kick * sin(ang * 7.0 + t * 9.0)
    + volt * (0.14 * u_low + 0.32 * u_kick);
  float rc = r * (1.0 - bassWarp * exp(-r * 3.0));
  float heart = exp(-rc * rc * (260.0 - 130.0 * u_kick));
  float corona = exp(-rc * (7.0 - 3.0 * u_low));
  // Gravity waves: concentric rings breathing out of the core with the
  // bassline itself (not just kicks) — sustained lows keep the center alive.
  float gravity = sin(rc * 46.0 - t * (3.0 + 9.0 * u_low)) * 0.5 + 0.5;
  float gravityGain = u_low * (0.5 + 0.8 * u_kick);
  // Gravity ripple color: a warm slice of the traveling palette, biased by
  // the spectral hue, replacing the fixed ember/LOW mix. Gain unchanged.
  vec3 gravityColor = hueRotate(palette(0.05 + t * 0.015 + u_specHue * 0.5), u_hueRot);
  fresh += gravityColor
    * pow(gravity, 4.0) * exp(-r * 5.0) * gravityGain;
  // The event horizon ring: a wide ember glow + a thin white-hot arc,
  // both jittering with the voltage field — THE bass element. Interior is
  // dark (centerDim), so the ring reads as the edge of the black hole.
  float arcJitter = volt * (0.012 + 0.05 * u_kick + 0.022 * u_low);
  // Focused + evolving: the ring CHARGES with kick energy (color runs
  // ember -> orange -> white-hot as charge builds) and each kick discharges
  // a wave from the horizon (the ripple new launch point).
  float ringGlow = exp(-pow((r - horizon - arcJitter) * 52.0, 2.0));
  float ringCore = exp(-pow((r - horizon - arcJitter) * 210.0, 2.0));
  float bassOn = smoothstep(0.06, 0.3, u_low);
  vec3 chargeColor = mix(palette(0.02 + u_specHue * 0.5), palette(0.12 + u_specHue * 0.5), clamp(u_charge, 0.0, 1.0));
  chargeColor = mix(chargeColor, vec3(1.0, 0.97, 0.92), clamp(u_charge - 0.6, 0.0, 0.4) * 2.5);
  fresh += chargeColor * ringGlow * (0.12 + 0.6 * u_low + 1.1 * u_kick + 0.5 * u_charge);
  fresh += mix(chargeColor, vec3(1.0), 0.5 * u_kick) * ringCore
    * (0.3 + 1.3 * bassOn + 2.4 * u_kick + 0.8 * u_charge);
  // Coal heart: a deep, low-luma slice of the traveling palette (spectral-hue
  // biased) instead of a fixed dark red — still whitens under a kick.
  vec3 coal = palette(0.0 + u_specHue * 0.5) * 0.55;
  fresh += mix(coal, vec3(1.0, 0.8, 0.7), 0.5 * u_kick) * heart * (0.5 + 1.2 * u_low + 1.4 * u_kick);
  fresh += mix(coal, LOW, 0.4) * corona * (0.1 + 0.6 * u_low + 0.35 * u_kick);
  // Radial dimmer keeps the middle dark so dust/stars read against it.
  float centerDim = smoothstep(horizon * 0.45, horizon * 1.2, r);
  // Anamorphic lens streak across the core — the spacey money shot.
  float streak = exp(-abs(c.y) * 110.0) * exp(-abs(c.x) * (4.5 - 1.5 * u_drop));
  fresh += hueRotate(mix(palette(0.7 + u_specHue * 0.5), palette(t * 0.02), 0.65), u_hueRot) * streak * (0.25 + 1.2 * u_low + 0.8 * u_kick);
  // The disk: spiral lanes + clouds in the TRAVELING palette.
  // g02: spread controls disk BREADTH — a narrow sound concentrates the
  // lanes into a tight bright band (steeper radial falloff), a wide sound
  // spreads them outward (shallower falloff). Energy-neutral.
  float breadth = mix(2.6, 1.15, clamp(u_spread, 0.0, 1.0));
  float bandGain = mix(1.35, 0.85, clamp(u_spread, 0.0, 1.0));
  float arm = sin(ang * 2.0 + log(r + 0.06) * 5.0 - u_armPhase + 0.5 * u_mid * sin(ang * 3.0 + r * 6.0 + t * 0.7));
  float lanes = pow(0.5 + 0.5 * arm, 3.0) * smoothstep(0.06, 0.2, r) * exp(-r * breadth) * bandGain;
  float cloudField = fbm(vec2(ang * 2.2 + r * 3.0 - t * 0.15, r * 5.0 + t * 0.06));
  float cloud = pow(cloudField, 2.4);
  // Wide phase span + spatial drift: the old 0.7·cloudField span sampled
  // under half a palette period (and blend positions average cosines
  // flatter still) — dust came out monochrome at many slider stops.
  // SPECTRAL DUST TINT: the dust palette phase is biased by the slow-tracked
  // centroid (u_specHue) so dust hue follows spectral content.
  vec3 diskColor = hueRotate(palette(cloudField * 1.5 + r * 0.35 + ang * 0.1 + t * 0.012 + u_centroid * 0.4 + u_specHue * 0.8), u_hueRot);
  // Kick reverberation: the traveling wavefront LIGHTS the dust it passes
  // through (displacement alone read as subtle; this makes it audible).
  float reverb = 1.0 + 2.6 * rippleWave;
  float midGate = smoothstep(0.04, 0.3, u_mid);
  // g02: dust SWELLS toward the phrase boundary (u_phrase), gently.
  float phraseSwell = 1.0 + 0.22 * u_phrase;
  fresh += diskColor * lanes * (0.1 + 1.2 * u_mid) * (0.5 + cloud) * u_dust * centerDim * midGate * reverb * phraseSwell;
  fresh += diskColor * cloud * exp(-r * mix(2.4, 1.4, clamp(u_spread, 0.0, 1.0))) * u_mid * 0.45 * u_dust * centerDim * midGate * reverb * phraseSwell;
  // HIGH NEBULA: distinct physics from the mid dust — finer scale,
  // counter-rotation, electric blue-white tint, fast shimmer flicker.
  // g02: flatness textures it — tonal (0) = silky smooth wisps (softer
  // power curve, no grain), noisy (1) = grainy sparkle (grain modulation).
  float wisp = fbm(vec2(ang * 6.0 - t * 0.5, r * 10.0 + t * 0.25));
  float shimmer = 0.6 + 0.4 * sin(t * 13.0 + wisp * 24.0);
  float silky = mix(4.0, 2.4, clamp(u_flatness, 0.0, 1.0));
  float grain = mix(1.0, 0.55 + 0.9 * hash(gl_FragCoord.xy + fract(t) * 53.0), clamp(u_flatness, 0.0, 1.0));
  // DISTINCT DUST HUE: the high nebula samples the palette at +0.35 phase
  // from the mid dust (biased by u_specHue) so the bands read as different
  // dust kinds, not one red/blue wash.
  vec3 electric = hueRotate(palette(0.35 + cloudField * 1.5 + r * 0.35 + ang * 0.1 + t * 0.012 + u_centroid * 0.4 + u_specHue * 0.8), u_hueRot);
  fresh += electric * pow(wisp, silky) * shimmer * grain * smoothstep(0.12, 0.5, r)
    * (0.08 + 1.7 * u_high) * u_dust * reverb;
  sky += fresh * (1.0 - u_decay) * (3.2 + 1.6 * u_sustain);

  // High-transient nebula PUFFS: stamped into the feedback at full
  // strength (like the old stars, but cloud-natured) — they persist,
  // shear into the spiral, and fade. Snare powder stays as-is.
  if (u_spawn > 0.01) {
    vec2 sOff = vec2(fract(u_seed * 0.7131) * 21.7, fract(u_seed * 0.3719) * 13.1);
    float puff = pow(fbm(c * 7.0 + sOff), 3.5);
    sky += electric * puff * smoothstep(0.1, 0.4, r) * u_spawn * 0.9;
  }

  // ---- Transient stamps.
  if (u_kick > 0.02) {
    float ringR = 0.1 + 0.05 * u_kick;
    float shock = exp(-pow((r - ringR) * 38.0, 2.0))
      + 0.6 * exp(-pow((r - ringR * 1.7) * 30.0, 2.0));
    sky += mix(palette(0.05 + u_specHue * 0.5), vec3(1.0, 0.9, 0.8), 0.5) * shock * u_kick * (1.15 + 0.8 * u_drop);
    // Whole-frame punch: a brief lift so the kick lands everywhere.
    sky *= 1.0 + 0.1 * u_kick;
  }
  if (u_snare > 0.03) {
    float arc = exp(-pow((r - 0.3) * 30.0, 2.0)) * pow(0.5 + 0.5 * sin(ang * 3.0 + u_seed), 2.0);
    sky += palette(0.3 + t * 0.02) * arc * u_snare * 0.7;
  }
  if (u_spawn > 0.003 || u_spawnSnare > 0.003) {
    float reach = smoothstep(0.05, 0.18, r);
    // Highs live in the nebula now (puffs above); only the snare powder
    // keeps discrete star points — the hit you liked. Palette-tinted so
    // the slider reaches them too.
    sky += starScatter(c + 11.3, 16.0, 2.8, 0.984, u_spawnSnare * 1.2) * reach
      * mix(vec3(1.0), palette(0.15), 0.45);
  }

  // Film grain — fine, a touch louder through the drop.
  sky += (hash(gl_FragCoord.xy + fract(t) * 191.0) - 0.5) * (0.012 + 0.02 * u_drop);

  // Palette grade: the whole frame leans toward the palette hue, so the
  // blend slider is legible even while bass-red owns the center.
  vec3 grade = palette(0.35 + u_centroid * 0.2);
  sky = mix(sky, sky * (0.4 + grade * 1.5), 0.24);
  // Buildups cool and dim slightly (tension), drops bloom.
  sky *= 0.72 + 0.45 * max(u_drop, u_sustain) - 0.05 * u_buildup;
  float m = max(sky.r, max(sky.g, sky.b));
  if (m > 0.8) {
    sky *= (0.8 + 0.2 * (1.0 - exp(-(m - 0.8) * 3.0))) / m;
  }
  gl_FragColor = vec4(max(sky, 0.0), 1.0);
}
`,vo={id:"g02-voyage-prime",name:"g02 voyage-prime",hiRes:!0,params:[{id:"stars",label:"star density",min:0,max:2,step:.05,default:1},{id:"dust",label:"dust amount",min:0,max:2,step:.05,default:1},{id:"palette",label:"palette blend (ember→nebula→aurora→solar)",min:0,max:3,step:.05,default:1},{id:"persistence",label:"persistence",min:.5,max:2,step:.05,default:1},{id:"speed",label:"flight speed",min:.2,max:2.5,step:.05,default:1}],create:()=>{let t=0,e=999,o=0,r=0,a=0,s=0,i=0,b=null,p=0,x=0,v=0,u=.5,w=0,g=0,k=null;return ue({fragment:_o,feedback:!0,uniforms:d=>{var D,H,q,O,W,F,z,L,N;const _=t>0?Math.min(.1,Math.max(0,d.time-t)):.016666666666666666;t=d.time;const f=X(d.bands),n=(D=d.params.speed)!=null?D:1,T=(H=d.params.persistence)!=null?H:1,C=Math.min(1,Math.max(0,(d.bands.low-.2)/.5)),M=1-Math.exp(-_/.35);a+=(d.trend.excitement*C-a)*M,s+=(d.trend.excitement*(1-C)-s)*M;const c=a,l=s,m=Math.min(1,f*1.4),P=Math.max(c,.7*m),h=1+(.08+.7*P+3.6*d.impulse.low*(.5+.5*P))*n*_-.3*l*_;r+=_*((q=d.beat)!=null&&q.bpm?d.beat.bpm/60*Math.PI*2/64:.12),i=Math.min(1.4,i*Math.exp(-_/2.5)+d.impulse.low*.28),e+=_,d.impulse.low>.35&&e>.12&&(e=0,o=Math.min(1,d.impulse.low*1.2));const y=d.beat;let S;y&&y.barIndex!==null?(b!==null&&y.barIndex!==b&&(y.barIndex%4+4)%4===0&&(p=0),b=y.barIndex,S=((y.barIndex%4+4)%4+y.barPhase)/4):S=.5+.5*Math.sin(d.time*.35),p+=(S-p)*(1-Math.exp(-_/.5)),x+=(((O=d.spread)!=null?O:0)-x)*(1-Math.exp(-_/.4)),v+=(((W=d.flatness)!=null?W:0)-v)*(1-Math.exp(-_/.4));const I=.992-.008*f-.008*l;u+=(d.centroid-u)*(1-Math.exp(-_/1));let A=null,E=-1;for(const G of d.decks)G.level>E&&(E=G.level,A=G.trackId);A!==null&&A!==k&&(k=A,g=go(A)),w+=(g-w)*(1-Math.exp(-_/2));const R=((w+(u-.5)*.8)%1+1)%1;return{u_time:d.time,u_low:d.bands.low,u_mid:d.bands.mid,u_high:d.bands.high,u_kick:d.impulse.low,u_snare:d.impulse.mid,u_centroid:d.centroid,u_specHue:u,u_hueRot:R,u_drop:c,u_buildup:l,u_zoom:h,u_rotStep:(.05+.5*d.bands.mid+.5*l+.25*m)*n*_,u_decay:Math.min(.998,1-(1-I)/T),u_seed:Math.floor(d.time*20),u_rippleAge:e,u_rippleAmp:o,u_sustain:m,u_armPhase:r,u_charge:i,u_dust:(F=d.params.dust)!=null?F:1,u_palette:(z=d.params.palette)!=null?z:1,u_spawn:Math.min(1,1.15*d.impulse.high+.2*d.bands.high)*((L=d.params.stars)!=null?L:1)*(.4+.6*Math.max(c,m))/(1+1.8*l)/(1+2.2*d.impulse.low),u_spawnSnare:Math.min(1,.95*d.impulse.mid)*((N=d.params.stars)!=null?N:1)*(.5+.5*Math.max(c,m))/(1+.8*l)/(1+2.2*d.impulse.low),u_phrase:Math.min(1,Math.max(0,p)),u_spread:Math.min(1,Math.max(0,x)),u_flatness:Math.min(1,Math.max(0,v))}}})}},bo=t=>{let e=Math.floor(Math.abs(t))+2654435769>>>0;return e=Math.imul(e^e>>>16,569420461)>>>0,e=Math.imul(e^e>>>15,1935289751)>>>0,e=(e^e>>>15)>>>0,e/4294967296},gt=24,xo=`
precision highp float;
uniform sampler2D u_prev;
uniform vec2 u_res;
uniform float u_time;
uniform float u_low;
uniform float u_mid;
uniform float u_midSlow;    // motion: slow bands (erratic-motion law) — churn advection rate
uniform float u_high;
uniform float u_kick;
uniform float u_snare;
uniform float u_centroid;   // temperature 0 cold .. 1 hot
uniform float u_material;   // 0 liquid glass .. 1 granular sand
uniform float u_phrase;     // phrase growth 0 (start) .. 1 (boundary)
uniform float u_section;    // section-transform pulse 0..1 (decays)
uniform float u_flip;       // section regime sign (drifts -1..1 across sections)
uniform float u_drop;       // excitement with bass
uniform float u_buildup;    // excitement without bass
uniform float u_decay;
uniform float u_seed;
uniform float u_rippleAge;  // seconds since last strong kick
uniform float u_rippleAmp;  // that kick's strength
uniform float u_flow;       // liquid inner-flow phase
uniform float u_swell;      // sustained loudness, form size
uniform float u_grain;      // sand-grain gain slider
uniform float u_glass;      // glass-caustic gain slider
uniform float u_bar;        // bar pulse 0..1 (peaks on the downbeat)
uniform float u_rebirth;    // rebirth cross-fade 0..1 (1 = settled)
uniform float u_symmetry;   // genome: base lobe count bias 3..9
uniform float u_gSculpt;    // sculpt gain slider
uniform float u_eqLow;      // dominant deck EQ 0.5 = flat, 0 = kill
uniform float u_eqMid;
uniform float u_eqHigh;
uniform float u_shardAge;   // seconds since last snare crack (ejection age)
uniform float u_shardAmp;   // that snare's strength (ejection energy)
uniform float u_shardAng;   // angle of the loudest spectral region (crack site)
uniform float u_shards;     // glass-shard gain slider
uniform float u_specHue;    // spectral hue anchor (JS ~1s EMA of centroid) 0..1
uniform float u_hueAnchor;  // DUST FIX v3: per-song genome hue anchor 0..1 (full wheel)
uniform float u_spectrum[24];

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

float fbm(vec2 p) {
  float v = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 5; i++) {
    v += amp * noise(p);
    p = p * 2.02 + vec2(19.7, 7.3);
    amp *= 0.5;
  }
  return v;
}

// EQ region gate: knob 0.5 = flat (1.0 gain), 0 = killed (0.0), 1 = boosted
// (up to ~1.6). A kill deletes that band's contribution to the surface.
float eqGate(float knob) {
  return clamp((knob - 0.5) * 2.0 + 1.0, 0.0, 1.7);
}

// SPECTRUM SCULPTURE: sum the 24 bands as angular harmonics. Band index maps
// to harmonic order — low bins are few large lobes, high bins many fine
// ripples. Each band is region-gated by the deck EQ. Constant-loop lookup.
float sculpt(float ang, float r, float t) {
  float disp = 0.0;
  for (int b = 0; b < 24; b++) {
    float fb = float(b);
    // Harmonic order: base symmetry + band index (low = big lobes).
    float order = u_symmetry + fb * 0.75;
    // Region gate: low third -> eqLow, mid third -> eqMid, top third -> eqHigh.
    float g = fb < 8.0 ? u_eqLow : (fb < 16.0 ? u_eqMid : u_eqHigh);
    // Amplitude falls with harmonic order (bass lobes dominate the silhouette).
    float fall = 1.0 / (1.0 + fb * 0.35);
    // Slow phase drift per band (seed-mixed) so the sculpture breathes.
    float ph = t * (0.15 + fb * 0.03) + u_seed * (0.11 + fb * 0.017)
      + r * (2.0 + fb * 0.6);
    disp += u_spectrum[b] * g * fall * sin(ang * order + ph);
  }
  return disp;
}

vec3 hsv2rgb(vec3 c) {
  vec3 p = abs(fract(c.xxx + vec3(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0);
  return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y);
}

// Temperature palette: cold<->hot MATERIAL identity still rides centroid, but
// the two endpoint HUE FAMILIES are now derived from spectral content
// (u_specHue) instead of a hardcoded blue<->red axis. COLD = cool family
// (teal/blue/violet), HOT = its warm complement. Per-endpoint lightness and
// the traveling wobble are preserved (chroma-only change) so the tint still
// TRAVELS with the surface field.
vec3 tempPalette(float t, float temp) {
  // DUST FIX v3: full-wheel cold/hot FAMILIES. The per-song anchor picks
  // the cold family; +0.8*(specHue-0.5) travels it with spectral content;
  // hot stays the complement. Different songs = different cold/hot pair.
  float coldHue = fract(u_hueAnchor + (u_specHue - 0.5) * 0.8 + 0.5);
  float hotHue = fract(coldHue - 0.5);
  vec3 coldRip = vec3(0.2, 0.35, 0.3)
    * cos(6.28318 * (vec3(0.9, 1.0, 0.8) * t + vec3(0.55, 0.42, 0.3)));
  vec3 hotRip = vec3(0.4, 0.35, 0.2)
    * cos(6.28318 * (vec3(1.0, 0.9, 0.7) * t + vec3(0.0, 0.1, 0.2)));
  float coldV = clamp(0.7 + (coldRip.r + coldRip.g + coldRip.b) * 0.33, 0.0, 1.3);
  float hotV = clamp(0.72 + (hotRip.r + hotRip.g + hotRip.b) * 0.33, 0.0, 1.3);
  vec3 cold = hsv2rgb(vec3(coldHue, 0.82, coldV));
  vec3 hot = hsv2rgb(vec3(hotHue, 0.88, hotV));
  return mix(cold, hot, clamp(temp, 0.0, 1.0));
}

// fringe fix: value-preserving hue ROTATION in YIQ chroma-plane (dust-v3
// idiom). rot is in TURNS; luminance (Y) is untouched by construction.
vec3 hueRotate(vec3 c, float rot) {
  float y = dot(c, vec3(0.299, 0.587, 0.114));
  float i = dot(c, vec3(0.596, -0.274, -0.322));
  float q = dot(c, vec3(0.211, -0.523, 0.312));
  float h = atan(q, i) + rot * 6.28318;
  float chroma = sqrt(i * i + q * q);
  i = chroma * cos(h);
  q = chroma * sin(h);
  return max(vec3(0.0), vec3(
    y + 0.956 * i + 0.621 * q,
    y - 0.272 * i - 0.647 * q,
    y - 1.106 * i - 1.703 * q
  ));
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  float aspect = u_res.x / u_res.y;
  vec2 c = (uv - 0.5) * vec2(aspect, 1.0);
  float r = length(c);
  float ang = atan(c.y, c.x);
  float t = u_time;
  vec2 px = 1.0 / u_res;
  vec2 dir = r > 1e-4 ? c / r : vec2(0.0);

  float mat = clamp(u_material, 0.0, 1.0);

  // ---- Warp / advection of the accumulated material.
  float churnScale = mix(2.4, 7.5, mat);
  float churnSpeed = mix(0.08, 0.9, mat);
  vec2 churn = (vec2(
    fbm(c * churnScale + u_flow + t * churnSpeed),
    fbm(c * churnScale + vec2(9.1, 4.7) - u_flow - t * churnSpeed)
  ) - 0.5) * mix(0.006, 0.02, mat) * (1.0 + 0.7 * u_midSlow); // motion: slow bands (erratic-motion law)

  // Localized lens swirl inside the core radius — glass refraction hint.
  float core = 0.16 + 0.12 * u_low + 0.05 * u_swell;
  float lens = (0.3 * u_low + 1.2 * u_kick) * exp(-pow(r / core, 2.0) * 1.5) * (1.0 - 0.6 * mat);
  float dcs = cos(lens * 0.4);
  float dsn = sin(lens * 0.4);
  vec2 w = mat2(dcs, -dsn, dsn, dcs) * c;

  // Traveling kick pressure wave — a solid displacement front that lights.
  float waveFront = 0.1 + u_rippleAge * 0.85;
  float rippleWave = exp(-pow((r - waveFront) * 10.0, 2.0)) * exp(-u_rippleAge * 2.2) * u_rippleAmp;
  vec2 ripple = dir * rippleWave * 0.04;

  // Section transform: a violent radial inversion pulse — space folds.
  float fold = u_section * 0.06 * sin(r * 20.0 - t * 6.0) * u_flip;
  vec2 src = (w + churn + ripple + dir * fold) / vec2(aspect, 1.0) + 0.5;

  // Sample previous frame. Glass chromatic split; sand dry. Unsharp tap.
  vec2 ab = dir * (0.0016 + 0.006 * u_drop + 0.01 * rippleWave) * (1.0 - mat)
    / vec2(aspect, 1.0);
  ab *= u_glass; // fringe amount rides the dust param (human note)
  // fringe fix: hue-steerable fringes -- rotate the field to the anchor
  // frame, split channels there, rotate back. Clamped >= 0 (hueRotate can
  // go slightly negative) so the unsharp feedback loop stays stable.
  float fringeRot = u_hueAnchor + (u_specHue - 0.5) * 0.8;
  vec3 tapA = texture2D(u_prev, src + ab).rgb;
  vec3 tapC = texture2D(u_prev, src).rgb;
  vec3 tapB = texture2D(u_prev, src - ab).rgb;
  vec3 sampled = max(vec3(0.0), hueRotate(vec3(
    hueRotate(tapA, -fringeRot).r,
    hueRotate(tapC, -fringeRot).g,
    hueRotate(tapB, -fringeRot).b
  ), fringeRot));
  vec3 blur = (texture2D(u_prev, src + vec2(px.x, 0.0)).rgb
    + texture2D(u_prev, src - vec2(px.x, 0.0)).rgb
    + texture2D(u_prev, src + vec2(0.0, px.y)).rgb
    + texture2D(u_prev, src - vec2(0.0, px.y)).rgb) * 0.25;
  float sharp = mix(1.4, 1.12, mat);
  vec3 field = max(vec3(0.0), sampled * sharp - blur * (sharp - 1.0)) * u_decay;

  // ---- The central organic form.
  // Radius grows with phrase, swells with loudness, PULSES with the bar.
  float formR = 0.2 + 0.11 * u_phrase + 0.07 * u_swell + 0.05 * u_low
    + 0.03 * u_bar;
  float surfFreq = mix(3.0, 11.0, mat) * (1.0 + 0.6 * u_phrase);
  float surfAmp = mix(0.045, 0.11, mat) * (0.6 + 0.7 * u_phrase);
  // Base fbm surface (texture floor; also caustic/grain source).
  float surf = fbm(vec2(ang * surfFreq * 0.5 + u_flow * 0.5, r * surfFreq + t * mix(0.1, 1.4, mat)));
  // SPECTRUM SCULPTURE: the 24-band displacement field is the dominant
  // shape driver — low bands push large lobes, high bands fine ripples.
  float spec = sculpt(ang, r, t) * u_gSculpt * (0.09 + 0.05 * u_phrase);
  float rr = r + (surf - 0.5) * surfAmp - spec * u_rebirth;
  // Edge softness is a material cue: glass crisp, sand dusty.
  float edge = mix(0.02, 0.09, mat) + 0.03 * u_buildup;
  float body = smoothstep(formR + edge, formR - edge, rr);
  float interior = smoothstep(formR, 0.0, rr);

  float temp = clamp(u_centroid, 0.0, 1.0);
  vec3 fresh = vec3(0.0);

  // GLASS look: caustic web + wet specular rim. Weighted by (1-mat).
  float glassW = (1.0 - mat) * u_glass;
  float caustic = pow(abs(sin((surf + fbm(c * 5.0 + u_flow)) * 6.28318 + t * 0.8)), 8.0);
  vec3 glassCol = tempPalette(surf * 1.2 + r * 0.4 + t * 0.03, temp);
  fresh += glassCol * caustic * interior * glassW * (0.6 + 1.4 * u_mid + 0.8 * u_swell);
  float rim = exp(-pow((rr - formR) * 60.0, 2.0));
  vec3 specCol = mix(vec3(0.7, 0.9, 1.0), vec3(1.0, 0.95, 0.85), temp);
  fresh += specCol * rim * glassW * (0.5 + 1.0 * u_high + 0.6 * u_kick);
  // Sculpted ridges catch extra rim light where spectrum displacement is
  // steep — the spectrum sculpture reads as embossed relief on the glass.
  fresh += specCol * rim * glassW * abs(spec) * 6.0 * (0.4 + 0.8 * u_high);

  // SAND look: granular scatter, dry matte, temperature-tinted.
  float matW = mat * u_grain;
  float g1 = hash(floor(c * mix(90.0, 240.0, u_high) + vec2(fract(u_seed * 0.7131) * 53.0, fract(u_seed * 0.3719) * 37.0)));
  float g2 = hash(floor(c * 150.0 + u_flow * 3.0 + 7.3));
  float grain = pow(max(g1, g2) * (0.4 + 0.6 * surf), 2.2);
  vec3 sandCol = tempPalette(surf * 0.8 + grain * 0.5 + t * 0.02, temp);
  fresh += sandCol * grain * body * matW * (0.7 + 1.2 * u_high + 0.9 * u_mid);
  // Sculpted crust: high-band ripples pile grain along the relief crests.
  fresh += sandCol * grain * body * matW * abs(spec) * 5.0 * (0.5 + 0.9 * u_high);
  float staticN = hash(gl_FragCoord.xy + fract(t * 3.0) * 211.0);
  fresh += sandCol * staticN * body * matW * (0.12 + 0.5 * u_high) * (0.5 + 0.5 * mat);

  // Core glow common to both regimes — the heart, hottest at high centroid,
  // pumped by the bar pulse.
  float heart = exp(-rr * rr * (12.0 - 6.0 * u_kick) / max(formR, 0.05));
  vec3 heartCol = mix(vec3(0.3, 0.55, 1.0), vec3(1.0, 0.75, 0.4), temp);
  heartCol = mix(heartCol, vec3(1.0, 0.97, 0.9), 0.5 * u_kick);
  fresh += heartCol * heart * (0.5 + 1.4 * u_low + 1.6 * u_kick + 0.6 * u_bar);

  // Section-transform bloom: on the pulse the whole form ERUPTS.
  vec3 burstCol = mix(tempPalette(t * 0.05, temp), vec3(1.0), 0.4 * u_section);
  float burst = exp(-pow((r - (0.15 + u_section * 0.5)) * 5.0, 2.0));
  fresh += burstCol * burst * u_section * (1.4 + 1.2 * u_drop);
  fresh += tempPalette(0.5 + t * 0.04, 1.0 - temp) * interior * u_section * 0.6;

  // Rebirth dissolve: while a track change re-genesises the form, the surface
  // scatters and re-coheres (u_rebirth 0 -> 1). Bright dust during transit.
  float rebirthGlow = (1.0 - u_rebirth) * exp(-pow((r - 0.3) * 4.0, 2.0));
  fresh += mix(glassCol, sandCol, mat) * rebirthGlow * (1.0 + u_swell);

  // Kick pressure wave LIGHTS the material it crosses.
  float reverb = 2.4 * rippleWave;
  fresh += mix(glassCol, sandCol, mat) * reverb * (0.6 + 0.6 * u_swell) * (body * 0.4 + interior);

  // Inject fresh at (1 - decay); buildups tense-but-alive, drops bloom.
  field += fresh * (1.0 - u_decay) * (3.0 + 1.6 * u_swell + 1.0 * u_drop);

  // ---- GLASS SHARDS (the ONE swapped element; replaces snare powder).
  // A snare impulse CRACKS the sculpted relief at the loudest spectral
  // region (u_shardAng) and ejects angular refractive shards outward. The
  // ejection front travels out from the boundary as the crack ages; the
  // shards are ANGULAR (sharp radial splinters, not a soft ring), gated by
  // mid/high band presence, and INHERIT the material — glassy specular
  // splinters when flatness is low, gritty scattering grit when high. As
  // the ejection ages they settle back toward the relief.
  float shardGate = clamp(0.35 * u_mid + 0.65 * u_high, 0.0, 1.0);
  if (u_shardAmp * shardGate > 0.02) {
    // Ejection front: shards leave the boundary and fly outward, then fall
    // back. Front radius peaks then recedes as the crack settles.
    float travel = u_shardAge * 0.9;
    float settle = exp(-u_shardAge * 2.4);            // ejection energy decay
    float ejectR = formR * 1.05 + travel * settle * 1.6;
    // Angular splinters: a high-order star centred on the crack site. The
    // shards are sharp (high exponent) so they read as faceted glass, not
    // a smooth arc.
    float rel = ang - u_shardAng;
    float facets = pow(0.5 + 0.5 * cos(rel * (9.0 + 14.0 * u_high)), 6.0);
    // Crack concentration: densest at the crack azimuth, fanning out.
    float fan = exp(-pow(rel, 2.0) * 1.6);
    // Radial shard shell at the ejection front (thin, bright, faceted).
    float shell = exp(-pow((r - ejectR) * 22.0, 2.0));
    float shard = shell * facets * (0.35 + 0.65 * fan);
    // Material inheritance: glassy specular (low flatness = low mat) vs
    // gritty scatter (high flatness = high mat). Grit gets a speckle break.
    float grit = hash(gl_FragCoord.xy + fract(u_shardAge * 7.0) * 173.0);
    float glassy = shard * (1.0 - mat);
    float gritty = shard * mat * (0.4 + 0.6 * grit);
    vec3 shardCol = mix(
      mix(tempPalette(0.15, temp), specCol, 0.5), // cold refractive splinter
      sandCol,                                    // inherits sand tint
      mat
    );
    float shardE = u_shardAmp * shardGate * u_shards * settle;
    field += shardCol * (glassy * 1.3 + gritty * 1.1) * shardE * 1.4;
  }

  // Whole-frame kick + bar punch — the low-end lands everywhere, solid.
  field *= 1.0 + 0.1 * u_kick + 0.05 * u_bar;

  // Temperature grade.
  vec3 grade = tempPalette(0.35, temp);
  field = mix(field, field * (0.45 + grade * 1.4), 0.2);
  // Buildups saturate + energize (songprint-spec: tense AND vibrant).
  field *= 0.78 + 0.42 * max(u_drop, u_swell) + 0.12 * u_buildup;

  // Chroma-preserving soft knee (never per-channel clamp).
  float m = max(field.r, max(field.g, field.b));
  if (m > 0.82) {
    field *= (0.82 + 0.18 * (1.0 - exp(-(m - 0.82) * 3.0))) / m;
  }
  gl_FragColor = vec4(max(field, 0.0), 1.0);
}
`,Oe=16;function wo(t){let e=t+2654435769|0;return e=Math.imul(e^e>>>16,569420461),e=Math.imul(e^e>>>15,1935289751),e=e^e>>>15,(e>>>0)/4294967296}function _t(t){let e=Math.floor(t)|0;const o=[];for(let r=0;r<4;r++)e=e+1831565813|0,o.push(wo(e+r*625341585));return[o[0],o[1],o[2],o[3]]}const ko={id:"g05-materia-shards",name:"g05 materia-shards",hiRes:!0,params:[{id:"material",label:"material bias (glass↔sand)",min:-.5,max:.5,step:.02,default:0},{id:"sculpt",label:"spectrum sculpt",min:0,max:2,step:.05,default:1},{id:"grain",label:"sand grain",min:0,max:2,step:.05,default:1},{id:"glass",label:"glass caustics",min:0,max:2,step:.05,default:1},{id:"shards",label:"glass shards",min:0,max:2,step:.05,default:1},{id:"persistence",label:"persistence",min:.5,max:2,step:.05,default:1},{id:"growth",label:"phrase growth",min:0,max:2,step:.05,default:1}],create:()=>{let t=0,e=999,o=0,r=0,a=0,s=0,i=0,b=0,p=.5,x=0,v=0,u=null,w=0,g=0,k=-1,d=999,_=0,f=0,n=-1,T=_t(0),C=1,M=!1,c=.5,l=.5,m=.5;const P=new Float32Array(gt);return ue({fragment:xo,feedback:!0,uniforms:h=>{var se,ie,ne,pe,fe,ce,ge,ee,de,Z,be,ye,_e,Re,Te;const y=t>0?Math.min(.1,Math.max(0,h.time-t)):.016666666666666666;t=h.time;const S=(se=h.params.persistence)!=null?se:1,I=(ie=h.params.growth)!=null?ie:1,A=(ne=h.params.material)!=null?ne:0,E=1-Math.exp(-y/.3);let R=(pe=h.decks.find(Q=>Q.channel===h.dominantChannel))!=null?pe:null;if(R===null)for(const Q of h.decks)Q.playing&&(R===null||Q.level>R.level)&&(R=Q);const D=Math.min(1,Math.max(0,.6*h.flatness+.4*h.spread+A+(T[1]-.5)*.3));a+=(D-a)*E;const H=Math.min(1,Math.max(0,(h.bands.low-.2)/.5));s+=(h.trend.excitement*H-s)*E,i+=(h.trend.excitement*(1-H)-i)*E;const q=Math.min(1,(h.bands.low+h.bands.mid)*.7+s*.4);b+=(q-b)*(1-Math.exp(-y/.5)),p+=(h.centroid-p)*(1-Math.exp(-y/1));let O=null,W=-1;for(const Q of h.decks)Q.level>W&&(W=Q.level,O=Q.trackId);O!==null&&O!==u&&(u=O,v=bo(O)),x+=(v-x)*(1-Math.exp(-y/2));const F=(fe=h.beat)!=null&&fe.bpm?h.beat.bpm/60*Math.PI*2/8:.35;r+=y*F*(.6+.9*a);let z=0,L=k,N=0;if(h.beat){const Q=(ce=h.beat.ladderBarIndex)!=null?ce:h.beat.barIndex;z=((Q%Oe+Oe)%Oe+h.beat.barPhase)/Oe,L=Math.floor(Q/Oe),N=Math.pow(1-h.beat.barPhase,2.4)}else z=.5-.5*Math.cos(h.time*.08),N=.5-.5*Math.cos(h.time*1.4);z=Math.min(1,z*I),L!==k&&k>=0&&(w=1,g=-g||1),k=L,w=Math.max(0,w-y/1.1);const G=(ge=R==null?void 0:R.trackId)!=null?ge:null,U=G!==null?G:Math.floor((h.centroid*331+h.spread*271+h.flatness*197)*101);M?U!==n&&(n=U,T=_t(U),C=0):(n=U,T=_t(U),C=1,M=!0),C=Math.min(1,C+y/2);const B=1-Math.exp(-y/.15),K=(ee=R==null?void 0:R.eq.low)!=null?ee:.5,ae=(de=R==null?void 0:R.eq.mid)!=null?de:.5,J=(Z=R==null?void 0:R.eq.high)!=null?Z:.5;c+=(K-c)*B,l+=(ae-l)*B,m+=(J-m)*B;const te=h.spectrum;let V=0,le=-1;for(let Q=0;Q<gt;Q++){const xe=Q<te.length?Math.min(1,Math.max(0,te[Q])):0;P[Q]=xe,xe>le&&(le=xe,V=Q)}e+=y,h.impulse.low>.35&&e>.12&&(e=0,o=Math.min(1,h.impulse.low*1.25)),d+=y;const j=Math.max(h.impulse.mid,h.impulse.high*.85);if(j>.12&&d>.09){d=0,_=Math.min(1,j*1.3);const Q=T[3]%1*Math.PI*2;f=V/gt*Math.PI*2+Q}const $=3+Math.floor(T[0]*7),he=.99-.008*Math.min(1,(h.bands.low+h.bands.mid+h.bands.high)/2)-.006*i-.004*a;return{u_time:h.time,u_low:h.bands.low,u_mid:h.bands.mid,u_midSlow:((be=h.bandsSlow)!=null?be:h.bands).mid,u_high:h.bands.high,u_kick:h.impulse.low,u_snare:h.impulse.mid,u_centroid:h.centroid,u_material:a,u_phrase:z,u_section:Math.max(0,Math.min(1,w)),u_flip:g||1,u_drop:s,u_buildup:i,u_decay:Math.min(.997,1-(1-he)/S),u_seed:T[3]*100,u_rippleAge:e,u_rippleAmp:o,u_flow:r,u_swell:b,u_grain:(ye=h.params.grain)!=null?ye:1,u_glass:(_e=h.params.glass)!=null?_e:1,u_bar:N,u_rebirth:C,u_symmetry:$,u_gSculpt:((Re=h.params.sculpt)!=null?Re:1)*(.6+.8*T[2]),u_eqLow:c,u_eqMid:l,u_eqHigh:m,u_shardAge:d,u_shardAmp:_,u_shardAng:f,u_shards:(Te=h.params.shards)!=null?Te:1,u_specHue:p,u_hueAnchor:x,u_spectrum:P}}})}},yo=t=>{let e=Math.floor(Math.abs(t))+2654435769>>>0;return e=Math.imul(e^e>>>16,569420461)>>>0,e=Math.imul(e^e>>>15,1935289751)>>>0,e=(e^e>>>15)>>>0,e/4294967296},Mo=`
precision highp float;
uniform sampler2D u_prev;
uniform vec2 u_res;
uniform float u_time;
uniform float u_low;
uniform float u_mid;
uniform float u_high;
uniform float u_kick;
uniform float u_snare;
uniform float u_centroid;   // temperature 0 cold .. 1 hot
uniform float u_material;   // 0 liquid glass .. 1 granular sand
uniform float u_phrase;     // phrase growth 0 (start) .. 1 (boundary)
uniform float u_section;    // section-transform pulse 0..1 (decays)
uniform float u_flip;       // section regime sign (drifts -1..1 across sections)
uniform float u_drop;       // excitement with bass
uniform float u_buildup;    // excitement without bass
uniform float u_decay;
uniform float u_seed;
uniform float u_rippleAge;  // seconds since last strong kick
uniform float u_rippleAmp;  // that kick's strength
uniform float u_flow;       // liquid inner-flow phase
uniform float u_swell;      // sustained loudness, form size
uniform float u_grain;      // sand-grain gain slider
uniform float u_glass;      // glass-caustic gain slider
uniform float u_specHue;    // spectral hue anchor (JS ~1s EMA of centroid) 0..1
uniform float u_hueAnchor;  // DUST FIX v3: per-song genome hue anchor 0..1 (full wheel)

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

float fbm(vec2 p) {
  float v = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 5; i++) {
    v += amp * noise(p);
    p = p * 2.02 + vec2(19.7, 7.3);
    amp *= 0.5;
  }
  return v;
}

vec3 hsv2rgb(vec3 c) {
  vec3 p = abs(fract(c.xxx + vec3(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0);
  return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y);
}

// Temperature palette: cold<->hot MATERIAL identity still rides centroid, but
// the two endpoint HUE FAMILIES are now derived from spectral content
// (u_specHue) instead of a hardcoded blue<->red axis. COLD = cool family
// (teal/blue/violet), HOT = its warm complement. Per-endpoint lightness and
// the traveling wobble are preserved (chroma-only change) so the tint still
// TRAVELS with the surface field rather than reading as one flat hue.
vec3 tempPalette(float t, float temp) {
  // DUST FIX v3: full-wheel cold/hot FAMILIES. The per-song anchor picks
  // the cold family; +0.8*(specHue-0.5) travels it with spectral content;
  // hot stays the complement. Different songs = different cold/hot pair.
  float coldHue = fract(u_hueAnchor + (u_specHue - 0.5) * 0.8 + 0.5);
  float hotHue = fract(coldHue - 0.5);
  vec3 coldRip = vec3(0.2, 0.35, 0.3)
    * cos(6.28318 * (vec3(0.9, 1.0, 0.8) * t + vec3(0.55, 0.42, 0.3)));
  vec3 hotRip = vec3(0.4, 0.35, 0.2)
    * cos(6.28318 * (vec3(1.0, 0.9, 0.7) * t + vec3(0.0, 0.1, 0.2)));
  float coldV = clamp(0.7 + (coldRip.r + coldRip.g + coldRip.b) * 0.33, 0.0, 1.3);
  float hotV = clamp(0.72 + (hotRip.r + hotRip.g + hotRip.b) * 0.33, 0.0, 1.3);
  vec3 cold = hsv2rgb(vec3(coldHue, 0.82, coldV));
  vec3 hot = hsv2rgb(vec3(hotHue, 0.88, hotV));
  return mix(cold, hot, clamp(temp, 0.0, 1.0));
}

// fringe fix: value-preserving hue ROTATION in YIQ chroma-plane (dust-v3
// idiom). rot is in TURNS; luminance (Y) is untouched by construction.
vec3 hueRotate(vec3 c, float rot) {
  float y = dot(c, vec3(0.299, 0.587, 0.114));
  float i = dot(c, vec3(0.596, -0.274, -0.322));
  float q = dot(c, vec3(0.211, -0.523, 0.312));
  float h = atan(q, i) + rot * 6.28318;
  float chroma = sqrt(i * i + q * q);
  i = chroma * cos(h);
  q = chroma * sin(h);
  return max(vec3(0.0), vec3(
    y + 0.956 * i + 0.621 * q,
    y - 0.272 * i - 0.647 * q,
    y - 1.106 * i - 1.703 * q
  ));
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  float aspect = u_res.x / u_res.y;
  vec2 c = (uv - 0.5) * vec2(aspect, 1.0);
  float r = length(c);
  float ang = atan(c.y, c.x);
  float t = u_time;
  vec2 px = 1.0 / u_res;
  vec2 dir = r > 1e-4 ? c / r : vec2(0.0);

  float mat = clamp(u_material, 0.0, 1.0);

  // ---- Warp / advection of the accumulated material.
  // Liquid regime: slow swirling refraction (a churn field kneads the
  // glass). Sand regime: fast, fine, jittery displacement (dry scatter).
  float churnScale = mix(2.4, 7.5, mat);
  float churnSpeed = mix(0.08, 0.9, mat);
  vec2 churn = (vec2(
    fbm(c * churnScale + u_flow + t * churnSpeed),
    fbm(c * churnScale + vec2(9.1, 4.7) - u_flow - t * churnSpeed)
  ) - 0.5) * mix(0.006, 0.02, mat) * (1.0 + 0.7 * u_mid);

  // Localized lens swirl inside the core radius — glass refraction, a hint
  // not a whirlpool (voyage's localized-lens idiom).
  float core = 0.16 + 0.12 * u_low + 0.05 * u_swell;
  float lens = (0.3 * u_low + 1.2 * u_kick) * exp(-pow(r / core, 2.0) * 1.5) * (1.0 - 0.6 * mat);
  float dcs = cos(lens * 0.4);
  float dsn = sin(lens * 0.4);
  vec2 w = mat2(dcs, -dsn, dsn, dcs) * c;

  // Traveling kick pressure wave — a solid displacement front that lights
  // the material it passes through.
  float waveFront = 0.1 + u_rippleAge * 0.85;
  float rippleWave = exp(-pow((r - waveFront) * 10.0, 2.0)) * exp(-u_rippleAge * 2.2) * u_rippleAmp;
  vec2 ripple = dir * rippleWave * 0.04;

  // Section transform: a violent radial inversion pulse — space folds
  // around the core for the duration of the pulse (the theatre beat).
  float fold = u_section * 0.06 * sin(r * 20.0 - t * 6.0) * u_flip;
  vec2 src = (w + churn + ripple + dir * fold) / vec2(aspect, 1.0) + 0.5;

  // Sample previous frame. Glass gets a chromatic refraction split; sand
  // gets none (dry). Unsharp anti-mush tap keeps caustics/grain crisp.
  vec2 ab = dir * (0.0016 + 0.006 * u_drop + 0.01 * rippleWave) * (1.0 - mat)
    / vec2(aspect, 1.0);
  ab *= u_glass; // fringe amount rides the dust param (human note)
  // fringe fix: hue-steerable fringes -- rotate the field to the anchor
  // frame, split channels there, rotate back. Clamped >= 0 (hueRotate can
  // go slightly negative) so the unsharp feedback loop stays stable.
  float fringeRot = 0.0; // CLASSIC red/blue aberration fluid (human: keep some presets classic)
  vec3 tapA = texture2D(u_prev, src + ab).rgb;
  vec3 tapC = texture2D(u_prev, src).rgb;
  vec3 tapB = texture2D(u_prev, src - ab).rgb;
  vec3 sampled = max(vec3(0.0), hueRotate(vec3(
    hueRotate(tapA, -fringeRot).r,
    hueRotate(tapC, -fringeRot).g,
    hueRotate(tapB, -fringeRot).b
  ), fringeRot));
  vec3 blur = (texture2D(u_prev, src + vec2(px.x, 0.0)).rgb
    + texture2D(u_prev, src - vec2(px.x, 0.0)).rgb
    + texture2D(u_prev, src + vec2(0.0, px.y)).rgb
    + texture2D(u_prev, src - vec2(0.0, px.y)).rgb) * 0.25;
  // Sand keeps more blur (scattering, matte); glass sharpens (specular).
  float sharp = mix(1.4, 1.12, mat);
  vec3 field = max(vec3(0.0), sampled * sharp - blur * (sharp - 1.0)) * u_decay;

  // ---- The central organic form.
  // Its radius grows with the phrase and swells with sustained loudness;
  // its surface is fbm-displaced, and the displacement AMPLITUDE and
  // frequency ride the material (glass = smooth low-freq undulation, sand
  // = high-freq broken crust). Phrase growth adds surface complexity.
  float formR = 0.2 + 0.11 * u_phrase + 0.07 * u_swell + 0.05 * u_low;
  float surfFreq = mix(3.0, 11.0, mat) * (1.0 + 0.6 * u_phrase);
  float surfAmp = mix(0.045, 0.11, mat) * (0.6 + 0.7 * u_phrase);
  // Surface field (also reused as caustic/grain source).
  float surf = fbm(vec2(ang * surfFreq * 0.5 + u_flow * 0.5, r * surfFreq + t * mix(0.1, 1.4, mat)));
  float rr = r + (surf - 0.5) * surfAmp;
  // Distance to the deformed boundary; edge softness is a MATERIAL cue:
  // glass = crisp wet edge, sand = soft dusty falloff.
  float edge = mix(0.02, 0.09, mat) + 0.03 * u_buildup;
  float body = smoothstep(formR + edge, formR - edge, rr);
  float interior = smoothstep(formR, 0.0, rr);

  float temp = clamp(u_centroid, 0.0, 1.0);
  vec3 fresh = vec3(0.0);

  // GLASS look: caustic web — sharp folded bright lines refracting through
  // the interior — plus a wet specular rim highlight. Weighted by (1-mat).
  float glassW = (1.0 - mat) * u_glass;
  float caustic = pow(abs(sin((surf + fbm(c * 5.0 + u_flow) ) * 6.28318 + t * 0.8)), 8.0);
  vec3 glassCol = tempPalette(surf * 1.2 + r * 0.4 + t * 0.03, temp);
  fresh += glassCol * caustic * interior * glassW * (0.6 + 1.4 * u_mid + 0.8 * u_swell);
  // Wet specular rim: a thin bright arc where light grazes the boundary.
  float rim = exp(-pow((rr - formR) * 60.0, 2.0));
  vec3 spec = mix(vec3(0.7, 0.9, 1.0), vec3(1.0, 0.95, 0.85), temp);
  fresh += spec * rim * glassW * (0.5 + 1.0 * u_high + 0.6 * u_kick);

  // SAND look: granular scatter — high-frequency speckle whose density and
  // brightness ride the surface field; dry, matte, temperature-tinted.
  float matW = mat * u_grain;
  float g1 = hash(floor(c * mix(90.0, 240.0, u_high) + vec2(fract(u_seed * 0.7131) * 53.0, fract(u_seed * 0.3719) * 37.0)));
  float g2 = hash(floor(c * 150.0 + u_flow * 3.0 + 7.3));
  float grain = pow(max(g1, g2) * (0.4 + 0.6 * surf), 2.2);
  vec3 sandCol = tempPalette(surf * 0.8 + grain * 0.5 + t * 0.02, temp);
  fresh += sandCol * grain * body * matW * (0.7 + 1.2 * u_high + 0.9 * u_mid);
  // Static shimmer: fast broadband flicker so sand reads as live static.
  float staticN = hash(gl_FragCoord.xy + fract(t * 3.0) * 211.0);
  fresh += sandCol * staticN * body * matW * (0.12 + 0.5 * u_high) * (0.5 + 0.5 * mat);

  // Core glow common to both regimes — the heart, hottest at high centroid.
  float heart = exp(-rr * rr * (12.0 - 6.0 * u_kick) / max(formR, 0.05));
  vec3 heartCol = mix(vec3(0.3, 0.55, 1.0), vec3(1.0, 0.75, 0.4), temp);
  heartCol = mix(heartCol, vec3(1.0, 0.97, 0.9), 0.5 * u_kick);
  fresh += heartCol * heart * (0.5 + 1.4 * u_low + 1.6 * u_kick);

  // Section-transform bloom: on the pulse the whole form ERUPTS — a bright
  // radial burst tinted by the incoming regime sign, the theatre moment.
  vec3 burstCol = mix(tempPalette(t * 0.05, temp), vec3(1.0), 0.4 * u_section);
  float burst = exp(-pow((r - (0.15 + u_section * 0.5)) * 5.0, 2.0));
  fresh += burstCol * burst * u_section * (1.4 + 1.2 * u_drop);
  // Inversion flash: the interior briefly negates toward the complementary
  // temperature — a mode change you can't miss.
  fresh += tempPalette(0.5 + t * 0.04, 1.0 - temp) * interior * u_section * 0.6;

  // Kick pressure wave LIGHTS the material it crosses (reverb-of-touch).
  float reverb = 2.4 * rippleWave;
  fresh += mix(glassCol, sandCol, mat) * reverb * (0.6 + 0.6 * u_swell) * (body * 0.4 + interior);

  // Inject fresh at (1 - decay); buildups tense-but-alive, drops bloom.
  field += fresh * (1.0 - u_decay) * (3.0 + 1.6 * u_swell + 1.0 * u_drop);

  // Snare stamp: a mid-transient ring crossing the surface (kept as a
  // discrete hit, mid/high natured — never a low-end powder).
  if (u_snare > 0.03) {
    float sarc = exp(-pow((r - formR * 1.15) * 26.0, 2.0))
      * pow(0.5 + 0.5 * sin(ang * 4.0 + u_seed), 2.0);
    field += mix(tempPalette(0.15, temp), tempPalette(0.3, temp), 0.5) * sarc * u_snare * 0.8;
  }

  // Whole-frame kick punch — the low-end lands everywhere, solid.
  field *= 1.0 + 0.1 * u_kick;

  // Temperature grade: lean the frame toward the centroid temperature so
  // cold/hot reads at a glance without swamping the material color.
  vec3 grade = tempPalette(0.35, temp);
  field = mix(field, field * (0.45 + grade * 1.4), 0.2);
  // Buildups cool + dim slightly (tension), drops bloom.
  field *= 0.74 + 0.42 * max(u_drop, u_swell) - 0.05 * u_buildup;

  // Chroma-preserving soft knee (never per-channel clamp).
  float m = max(field.r, max(field.g, field.b));
  if (m > 0.82) {
    field *= (0.82 + 0.18 * (1.0 - exp(-(m - 0.82) * 3.0))) / m;
  }
  gl_FragColor = vec4(max(field, 0.0), 1.0);
}
`,Le=16,Ro={id:"g02-materia",name:"g02 materia",hiRes:!0,params:[{id:"material",label:"material bias (glass↔sand)",min:-.5,max:.5,step:.02,default:0},{id:"grain",label:"sand grain",min:0,max:2,step:.05,default:1},{id:"glass",label:"glass caustics",min:0,max:2,step:.05,default:1},{id:"persistence",label:"persistence",min:.5,max:2,step:.05,default:1},{id:"growth",label:"phrase growth",min:0,max:2,step:.05,default:1}],create:()=>{let t=0,e=999,o=0,r=0,a=0,s=0,i=0,b=0,p=.5,x=0,v=0,u=null,w=0,g=0,k=-1;return ue({fragment:Mo,feedback:!0,uniforms:d=>{var E,R,D,H,q,O;const _=t>0?Math.min(.1,Math.max(0,d.time-t)):.016666666666666666;t=d.time;const f=(E=d.params.persistence)!=null?E:1,n=(R=d.params.growth)!=null?R:1,T=(D=d.params.material)!=null?D:0,C=1-Math.exp(-_/.3),M=Math.min(1,Math.max(0,.6*d.flatness+.4*d.spread+T));a+=(M-a)*C;const c=Math.min(1,Math.max(0,(d.bands.low-.2)/.5));s+=(d.trend.excitement*c-s)*C,i+=(d.trend.excitement*(1-c)-i)*C;const l=Math.min(1,(d.bands.low+d.bands.mid)*.7+s*.4);b+=(l-b)*(1-Math.exp(-_/.5)),p+=(d.centroid-p)*(1-Math.exp(-_/1));let m=null,P=-1;for(const W of d.decks)W.level>P&&(P=W.level,m=W.trackId);m!==null&&m!==u&&(u=m,v=yo(m)),x+=(v-x)*(1-Math.exp(-_/2));const h=(H=d.beat)!=null&&H.bpm?d.beat.bpm/60*Math.PI*2/8:.35;r+=_*h*(.6+.9*a);let y=0,S=k;d.beat?(y=((d.beat.barIndex%Le+Le)%Le+d.beat.barPhase)/Le,S=Math.floor(d.beat.barIndex/Le)):y=.5-.5*Math.cos(d.time*.08),y=Math.min(1,y*n),S!==k&&k>=0&&(w=1,g=-g||1),k=S,w=Math.max(0,w-_/1.1),e+=_,d.impulse.low>.35&&e>.12&&(e=0,o=Math.min(1,d.impulse.low*1.25));const A=.99-.008*Math.min(1,(d.bands.low+d.bands.mid+d.bands.high)/2)-.006*i-.004*a;return{u_time:d.time,u_low:d.bands.low,u_mid:d.bands.mid,u_high:d.bands.high,u_kick:d.impulse.low,u_snare:d.impulse.mid,u_centroid:d.centroid,u_material:a,u_phrase:y,u_section:Math.max(0,Math.min(1,w)),u_flip:g||1,u_drop:s,u_buildup:i,u_decay:Math.min(.997,1-(1-A)/f),u_seed:Math.floor(d.time*20),u_rippleAge:e,u_rippleAmp:o,u_flow:r,u_swell:b,u_grain:(q=d.params.grain)!=null?q:1,u_glass:(O=d.params.glass)!=null?O:1,u_specHue:p,u_hueAnchor:x}}})}},So=t=>{let e=Math.floor(Math.abs(t))+2654435769>>>0;return e=Math.imul(e^e>>>16,569420461)>>>0,e=Math.imul(e^e>>>15,1935289751)>>>0,e=(e^e>>>15)>>>0,e/4294967296},Yt=24,Ao=`
precision highp float;
uniform sampler2D u_prev;
uniform vec2 u_res;
uniform float u_time;
uniform float u_low;
uniform float u_mid;
uniform float u_midSlow;    // motion: slow bands (erratic-motion law) — churn advection rate
uniform float u_high;
uniform float u_kick;
uniform float u_snare;
uniform float u_centroid;   // temperature 0 cold .. 1 hot
uniform float u_material;   // 0 liquid glass .. 1 granular sand
uniform float u_phrase;     // phrase growth 0 (start) .. 1 (boundary)
uniform float u_section;    // section-transform pulse 0..1 (decays)
uniform float u_flip;       // section regime sign (drifts -1..1 across sections)
uniform float u_drop;       // excitement with bass
uniform float u_buildup;    // excitement without bass
uniform float u_decay;
uniform float u_seed;
uniform float u_rippleAge;  // seconds since last strong kick
uniform float u_rippleAmp;  // that kick's strength
uniform float u_flow;       // liquid inner-flow phase
uniform float u_swell;      // sustained loudness, form size
uniform float u_grain;      // sand-grain gain slider
uniform float u_glass;      // glass-caustic gain slider
uniform float u_bar;        // bar pulse 0..1 (peaks on the downbeat)
uniform float u_rebirth;    // rebirth cross-fade 0..1 (1 = settled)
uniform float u_symmetry;   // genome: base lobe count bias 3..9
uniform float u_gSculpt;    // sculpt gain slider
uniform float u_eqLow;      // dominant deck EQ 0.5 = flat, 0 = kill
uniform float u_eqMid;
uniform float u_eqHigh;
uniform float u_specHue;    // spectral hue anchor (JS ~1s EMA of centroid) 0..1
uniform float u_hueAnchor;  // DUST FIX v3: per-song genome hue anchor 0..1 (full wheel)
uniform float u_spectrum[24];

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

float fbm(vec2 p) {
  float v = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 5; i++) {
    v += amp * noise(p);
    p = p * 2.02 + vec2(19.7, 7.3);
    amp *= 0.5;
  }
  return v;
}

// EQ region gate: knob 0.5 = flat (1.0 gain), 0 = killed (0.0), 1 = boosted
// (up to ~1.6). A kill deletes that band's contribution to the surface.
float eqGate(float knob) {
  return clamp((knob - 0.5) * 2.0 + 1.0, 0.0, 1.7);
}

// SPECTRUM SCULPTURE: sum the 24 bands as angular harmonics. Band index maps
// to harmonic order — low bins are few large lobes, high bins many fine
// ripples. Each band is region-gated by the deck EQ. Constant-loop lookup.
float sculpt(float ang, float r, float t) {
  float disp = 0.0;
  for (int b = 0; b < 24; b++) {
    float fb = float(b);
    // Harmonic order: base symmetry + band index (low = big lobes).
    float order = u_symmetry + fb * 0.75;
    // Region gate: low third -> eqLow, mid third -> eqMid, top third -> eqHigh.
    float g = fb < 8.0 ? u_eqLow : (fb < 16.0 ? u_eqMid : u_eqHigh);
    // Amplitude falls with harmonic order (bass lobes dominate the silhouette).
    float fall = 1.0 / (1.0 + fb * 0.35);
    // Slow phase drift per band (seed-mixed) so the sculpture breathes.
    float ph = t * (0.15 + fb * 0.03) + u_seed * (0.11 + fb * 0.017)
      + r * (2.0 + fb * 0.6);
    disp += u_spectrum[b] * g * fall * sin(ang * order + ph);
  }
  return disp;
}

vec3 hsv2rgb(vec3 c) {
  vec3 p = abs(fract(c.xxx + vec3(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0);
  return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y);
}

// Temperature palette: cold<->hot MATERIAL identity still rides centroid, but
// the two endpoint HUE FAMILIES are now derived from spectral content
// (u_specHue) instead of a hardcoded blue<->red axis. COLD = cool family
// (teal/blue/violet), HOT = its warm complement. Per-endpoint lightness and
// the traveling wobble are preserved (chroma-only change) so the tint still
// TRAVELS with the surface field.
vec3 tempPalette(float t, float temp) {
  // DUST FIX v3: full-wheel cold/hot FAMILIES. The per-song anchor picks
  // the cold family; +0.8*(specHue-0.5) travels it with spectral content;
  // hot stays the complement. Different songs = different cold/hot pair.
  float coldHue = fract(u_hueAnchor + (u_specHue - 0.5) * 0.8 + 0.5);
  float hotHue = fract(coldHue - 0.5);
  vec3 coldRip = vec3(0.2, 0.35, 0.3)
    * cos(6.28318 * (vec3(0.9, 1.0, 0.8) * t + vec3(0.55, 0.42, 0.3)));
  vec3 hotRip = vec3(0.4, 0.35, 0.2)
    * cos(6.28318 * (vec3(1.0, 0.9, 0.7) * t + vec3(0.0, 0.1, 0.2)));
  float coldV = clamp(0.7 + (coldRip.r + coldRip.g + coldRip.b) * 0.33, 0.0, 1.3);
  float hotV = clamp(0.72 + (hotRip.r + hotRip.g + hotRip.b) * 0.33, 0.0, 1.3);
  vec3 cold = hsv2rgb(vec3(coldHue, 0.82, coldV));
  vec3 hot = hsv2rgb(vec3(hotHue, 0.88, hotV));
  return mix(cold, hot, clamp(temp, 0.0, 1.0));
}

// fringe fix: value-preserving hue ROTATION in YIQ chroma-plane (dust-v3
// idiom). rot is in TURNS; luminance (Y) is untouched by construction.
vec3 hueRotate(vec3 c, float rot) {
  float y = dot(c, vec3(0.299, 0.587, 0.114));
  float i = dot(c, vec3(0.596, -0.274, -0.322));
  float q = dot(c, vec3(0.211, -0.523, 0.312));
  float h = atan(q, i) + rot * 6.28318;
  float chroma = sqrt(i * i + q * q);
  i = chroma * cos(h);
  q = chroma * sin(h);
  return max(vec3(0.0), vec3(
    y + 0.956 * i + 0.621 * q,
    y - 0.272 * i - 0.647 * q,
    y - 1.106 * i - 1.703 * q
  ));
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  float aspect = u_res.x / u_res.y;
  vec2 c = (uv - 0.5) * vec2(aspect, 1.0);
  float r = length(c);
  float ang = atan(c.y, c.x);
  float t = u_time;
  vec2 px = 1.0 / u_res;
  vec2 dir = r > 1e-4 ? c / r : vec2(0.0);

  float mat = clamp(u_material, 0.0, 1.0);

  // ---- Warp / advection of the accumulated material.
  float churnScale = mix(2.4, 7.5, mat);
  float churnSpeed = mix(0.08, 0.9, mat);
  vec2 churn = (vec2(
    fbm(c * churnScale + u_flow + t * churnSpeed),
    fbm(c * churnScale + vec2(9.1, 4.7) - u_flow - t * churnSpeed)
  ) - 0.5) * mix(0.006, 0.02, mat) * (1.0 + 0.7 * u_midSlow); // motion: slow bands (erratic-motion law)

  // Localized lens swirl inside the core radius — glass refraction hint.
  float core = 0.16 + 0.12 * u_low + 0.05 * u_swell;
  float lens = (0.3 * u_low + 1.2 * u_kick) * exp(-pow(r / core, 2.0) * 1.5) * (1.0 - 0.6 * mat);
  float dcs = cos(lens * 0.4);
  float dsn = sin(lens * 0.4);
  vec2 w = mat2(dcs, -dsn, dsn, dcs) * c;

  // Traveling kick pressure wave — a solid displacement front that lights.
  float waveFront = 0.1 + u_rippleAge * 0.85;
  float rippleWave = exp(-pow((r - waveFront) * 10.0, 2.0)) * exp(-u_rippleAge * 2.2) * u_rippleAmp;
  vec2 ripple = dir * rippleWave * 0.04;

  // Section transform: a violent radial inversion pulse — space folds.
  float fold = u_section * 0.06 * sin(r * 20.0 - t * 6.0) * u_flip;
  vec2 src = (w + churn + ripple + dir * fold) / vec2(aspect, 1.0) + 0.5;

  // Sample previous frame. Glass chromatic split; sand dry. Unsharp tap.
  vec2 ab = dir * (0.0016 + 0.006 * u_drop + 0.01 * rippleWave) * (1.0 - mat)
    / vec2(aspect, 1.0);
  ab *= u_glass; // fringe amount rides the dust param (human note)
  // fringe fix: hue-steerable fringes -- rotate the field to the anchor
  // frame, split channels there, rotate back. Clamped >= 0 (hueRotate can
  // go slightly negative) so the unsharp feedback loop stays stable.
  float fringeRot = u_hueAnchor + (u_specHue - 0.5) * 0.8;
  vec3 tapA = texture2D(u_prev, src + ab).rgb;
  vec3 tapC = texture2D(u_prev, src).rgb;
  vec3 tapB = texture2D(u_prev, src - ab).rgb;
  vec3 sampled = max(vec3(0.0), hueRotate(vec3(
    hueRotate(tapA, -fringeRot).r,
    hueRotate(tapC, -fringeRot).g,
    hueRotate(tapB, -fringeRot).b
  ), fringeRot));
  vec3 blur = (texture2D(u_prev, src + vec2(px.x, 0.0)).rgb
    + texture2D(u_prev, src - vec2(px.x, 0.0)).rgb
    + texture2D(u_prev, src + vec2(0.0, px.y)).rgb
    + texture2D(u_prev, src - vec2(0.0, px.y)).rgb) * 0.25;
  float sharp = mix(1.4, 1.12, mat);
  vec3 field = max(vec3(0.0), sampled * sharp - blur * (sharp - 1.0)) * u_decay;

  // ---- The central organic form.
  // Radius grows with phrase, swells with loudness, PULSES with the bar.
  float formR = 0.2 + 0.11 * u_phrase + 0.07 * u_swell + 0.05 * u_low
    + 0.03 * u_bar;
  float surfFreq = mix(3.0, 11.0, mat) * (1.0 + 0.6 * u_phrase);
  float surfAmp = mix(0.045, 0.11, mat) * (0.6 + 0.7 * u_phrase);
  // Base fbm surface (texture floor; also caustic/grain source).
  float surf = fbm(vec2(ang * surfFreq * 0.5 + u_flow * 0.5, r * surfFreq + t * mix(0.1, 1.4, mat)));
  // SPECTRUM SCULPTURE: the 24-band displacement field is the dominant
  // shape driver — low bands push large lobes, high bands fine ripples.
  float spec = sculpt(ang, r, t) * u_gSculpt * (0.09 + 0.05 * u_phrase);
  float rr = r + (surf - 0.5) * surfAmp - spec * u_rebirth;
  // Edge softness is a material cue: glass crisp, sand dusty.
  float edge = mix(0.02, 0.09, mat) + 0.03 * u_buildup;
  float body = smoothstep(formR + edge, formR - edge, rr);
  float interior = smoothstep(formR, 0.0, rr);

  float temp = clamp(u_centroid, 0.0, 1.0);
  vec3 fresh = vec3(0.0);

  // GLASS look: caustic web + wet specular rim. Weighted by (1-mat).
  float glassW = (1.0 - mat) * u_glass;
  float caustic = pow(abs(sin((surf + fbm(c * 5.0 + u_flow)) * 6.28318 + t * 0.8)), 8.0);
  vec3 glassCol = tempPalette(surf * 1.2 + r * 0.4 + t * 0.03, temp);
  fresh += glassCol * caustic * interior * glassW * (0.6 + 1.4 * u_mid + 0.8 * u_swell);
  float rim = exp(-pow((rr - formR) * 60.0, 2.0));
  vec3 specCol = mix(vec3(0.7, 0.9, 1.0), vec3(1.0, 0.95, 0.85), temp);
  fresh += specCol * rim * glassW * (0.5 + 1.0 * u_high + 0.6 * u_kick);
  // Sculpted ridges catch extra rim light where spectrum displacement is
  // steep — the spectrum sculpture reads as embossed relief on the glass.
  fresh += specCol * rim * glassW * abs(spec) * 6.0 * (0.4 + 0.8 * u_high);

  // SAND look: granular scatter, dry matte, temperature-tinted.
  float matW = mat * u_grain;
  float g1 = hash(floor(c * mix(90.0, 240.0, u_high) + vec2(fract(u_seed * 0.7131) * 53.0, fract(u_seed * 0.3719) * 37.0)));
  float g2 = hash(floor(c * 150.0 + u_flow * 3.0 + 7.3));
  float grain = pow(max(g1, g2) * (0.4 + 0.6 * surf), 2.2);
  vec3 sandCol = tempPalette(surf * 0.8 + grain * 0.5 + t * 0.02, temp);
  fresh += sandCol * grain * body * matW * (0.7 + 1.2 * u_high + 0.9 * u_mid);
  // Sculpted crust: high-band ripples pile grain along the relief crests.
  fresh += sandCol * grain * body * matW * abs(spec) * 5.0 * (0.5 + 0.9 * u_high);
  float staticN = hash(gl_FragCoord.xy + fract(t * 3.0) * 211.0);
  fresh += sandCol * staticN * body * matW * (0.12 + 0.5 * u_high) * (0.5 + 0.5 * mat);

  // Core glow common to both regimes — the heart, hottest at high centroid,
  // pumped by the bar pulse.
  float heart = exp(-rr * rr * (12.0 - 6.0 * u_kick) / max(formR, 0.05));
  vec3 heartCol = mix(vec3(0.3, 0.55, 1.0), vec3(1.0, 0.75, 0.4), temp);
  heartCol = mix(heartCol, vec3(1.0, 0.97, 0.9), 0.5 * u_kick);
  fresh += heartCol * heart * (0.5 + 1.4 * u_low + 1.6 * u_kick + 0.6 * u_bar);

  // Section-transform bloom: on the pulse the whole form ERUPTS.
  vec3 burstCol = mix(tempPalette(t * 0.05, temp), vec3(1.0), 0.4 * u_section);
  float burst = exp(-pow((r - (0.15 + u_section * 0.5)) * 5.0, 2.0));
  fresh += burstCol * burst * u_section * (1.4 + 1.2 * u_drop);
  fresh += tempPalette(0.5 + t * 0.04, 1.0 - temp) * interior * u_section * 0.6;

  // Rebirth dissolve: while a track change re-genesises the form, the surface
  // scatters and re-coheres (u_rebirth 0 -> 1). Bright dust during transit.
  float rebirthGlow = (1.0 - u_rebirth) * exp(-pow((r - 0.3) * 4.0, 2.0));
  fresh += mix(glassCol, sandCol, mat) * rebirthGlow * (1.0 + u_swell);

  // Kick pressure wave LIGHTS the material it crosses.
  float reverb = 2.4 * rippleWave;
  fresh += mix(glassCol, sandCol, mat) * reverb * (0.6 + 0.6 * u_swell) * (body * 0.4 + interior);

  // Inject fresh at (1 - decay); buildups tense-but-alive, drops bloom.
  field += fresh * (1.0 - u_decay) * (3.0 + 1.6 * u_swell + 1.0 * u_drop);

  // Snare stamp: a mid-transient ring crossing the surface.
  if (u_snare > 0.03) {
    float sarc = exp(-pow((r - formR * 1.15) * 26.0, 2.0))
      * pow(0.5 + 0.5 * sin(ang * 4.0 + u_seed), 2.0);
    field += mix(tempPalette(0.15, temp), tempPalette(0.3, temp), 0.5) * sarc * u_snare * 0.8;
  }

  // Whole-frame kick + bar punch — the low-end lands everywhere, solid.
  field *= 1.0 + 0.1 * u_kick + 0.05 * u_bar;

  // Temperature grade.
  vec3 grade = tempPalette(0.35, temp);
  field = mix(field, field * (0.45 + grade * 1.4), 0.2);
  // Buildups saturate + energize (songprint-spec: tense AND vibrant).
  field *= 0.78 + 0.42 * max(u_drop, u_swell) + 0.12 * u_buildup;

  // Chroma-preserving soft knee (never per-channel clamp).
  float m = max(field.r, max(field.g, field.b));
  if (m > 0.82) {
    field *= (0.82 + 0.18 * (1.0 - exp(-(m - 0.82) * 3.0))) / m;
  }
  gl_FragColor = vec4(max(field, 0.0), 1.0);
}
`,Be=16;function Co(t){let e=t+2654435769|0;return e=Math.imul(e^e>>>16,569420461),e=Math.imul(e^e>>>15,1935289751),e=e^e>>>15,(e>>>0)/4294967296}function vt(t){let e=Math.floor(t)|0;const o=[];for(let r=0;r<4;r++)e=e+1831565813|0,o.push(Co(e+r*625341585));return[o[0],o[1],o[2],o[3]]}const To={id:"g03-materia-deep",name:"g03 materia-deep",hiRes:!0,params:[{id:"material",label:"material bias (glass↔sand)",min:-.5,max:.5,step:.02,default:0},{id:"sculpt",label:"spectrum sculpt",min:0,max:2,step:.05,default:1},{id:"grain",label:"sand grain",min:0,max:2,step:.05,default:1},{id:"glass",label:"glass caustics",min:0,max:2,step:.05,default:1},{id:"persistence",label:"persistence",min:.5,max:2,step:.05,default:1},{id:"growth",label:"phrase growth",min:0,max:2,step:.05,default:1}],create:()=>{let t=0,e=999,o=0,r=0,a=0,s=0,i=0,b=0,p=.5,x=0,v=0,u=null,w=0,g=0,k=-1,d=-1,_=vt(0),f=1,n=!1,T=.5,C=.5,M=.5;const c=new Float32Array(Yt);return ue({fragment:Ao,feedback:!0,uniforms:l=>{var V,le,j,$,oe,he,se,ie,ne,pe,fe,ce,ge;const m=t>0?Math.min(.1,Math.max(0,l.time-t)):.016666666666666666;t=l.time;const P=(V=l.params.persistence)!=null?V:1,h=(le=l.params.growth)!=null?le:1,y=(j=l.params.material)!=null?j:0,S=1-Math.exp(-m/.3);let I=($=l.decks.find(ee=>ee.channel===l.dominantChannel))!=null?$:null;if(I===null)for(const ee of l.decks)ee.playing&&(I===null||ee.level>I.level)&&(I=ee);const A=Math.min(1,Math.max(0,.6*l.flatness+.4*l.spread+y+(_[1]-.5)*.3));a+=(A-a)*S;const E=Math.min(1,Math.max(0,(l.bands.low-.2)/.5));s+=(l.trend.excitement*E-s)*S,i+=(l.trend.excitement*(1-E)-i)*S;const R=Math.min(1,(l.bands.low+l.bands.mid)*.7+s*.4);b+=(R-b)*(1-Math.exp(-m/.5)),p+=(l.centroid-p)*(1-Math.exp(-m/1));let D=null,H=-1;for(const ee of l.decks)ee.level>H&&(H=ee.level,D=ee.trackId);D!==null&&D!==u&&(u=D,v=So(D)),x+=(v-x)*(1-Math.exp(-m/2));const q=(oe=l.beat)!=null&&oe.bpm?l.beat.bpm/60*Math.PI*2/8:.35;r+=m*q*(.6+.9*a);let O=0,W=k,F=0;l.beat?(O=((l.beat.barIndex%Be+Be)%Be+l.beat.barPhase)/Be,W=Math.floor(l.beat.barIndex/Be),F=Math.pow(1-l.beat.barPhase,2.4)):(O=.5-.5*Math.cos(l.time*.08),F=.5-.5*Math.cos(l.time*1.4)),O=Math.min(1,O*h),W!==k&&k>=0&&(w=1,g=-g||1),k=W,w=Math.max(0,w-m/1.1);const z=(he=I==null?void 0:I.trackId)!=null?he:null,L=z!==null?z:Math.floor((l.centroid*331+l.spread*271+l.flatness*197)*101);n?L!==d&&(d=L,_=vt(L),f=0):(d=L,_=vt(L),f=1,n=!0),f=Math.min(1,f+m/2);const N=1-Math.exp(-m/.15),G=(se=I==null?void 0:I.eq.low)!=null?se:.5,U=(ie=I==null?void 0:I.eq.mid)!=null?ie:.5,B=(ne=I==null?void 0:I.eq.high)!=null?ne:.5;T+=(G-T)*N,C+=(U-C)*N,M+=(B-M)*N;const K=l.spectrum;for(let ee=0;ee<Yt;ee++){const de=ee<K.length?K[ee]:0;c[ee]=Math.min(1,Math.max(0,de))}e+=m,l.impulse.low>.35&&e>.12&&(e=0,o=Math.min(1,l.impulse.low*1.25));const ae=3+Math.floor(_[0]*7),te=.99-.008*Math.min(1,(l.bands.low+l.bands.mid+l.bands.high)/2)-.006*i-.004*a;return{u_time:l.time,u_low:l.bands.low,u_mid:l.bands.mid,u_midSlow:((pe=l.bandsSlow)!=null?pe:l.bands).mid,u_high:l.bands.high,u_kick:l.impulse.low,u_snare:l.impulse.mid,u_centroid:l.centroid,u_material:a,u_phrase:O,u_section:Math.max(0,Math.min(1,w)),u_flip:g||1,u_drop:s,u_buildup:i,u_decay:Math.min(.997,1-(1-te)/P),u_seed:_[3]*100,u_rippleAge:e,u_rippleAmp:o,u_flow:r,u_swell:b,u_grain:(fe=l.params.grain)!=null?fe:1,u_glass:(ce=l.params.glass)!=null?ce:1,u_bar:F,u_rebirth:f,u_symmetry:ae,u_gSculpt:((ge=l.params.sculpt)!=null?ge:1)*(.6+.8*_[2]),u_eqLow:T,u_eqMid:C,u_eqHigh:M,u_specHue:p,u_hueAnchor:x,u_spectrum:c}}})}},Io=t=>{let e=Math.floor(Math.abs(t))+2654435769>>>0;return e=Math.imul(e^e>>>16,569420461)>>>0,e=Math.imul(e^e>>>15,1935289751)>>>0,e=(e^e>>>15)>>>0,e/4294967296},Xt=24,Po=`
precision highp float;
uniform sampler2D u_prev;
uniform vec2 u_res;
uniform float u_time;
uniform float u_low;
uniform float u_mid;
uniform float u_midSlow;    // motion: slow bands (erratic-motion law) — churn advection rate
uniform float u_high;
uniform float u_kick;
uniform float u_snare;
uniform float u_centroid;   // temperature 0 cold .. 1 hot
uniform float u_material;   // 0 liquid glass .. 1 granular sand (surface feel)
uniform float u_phrase;     // phrase growth 0 (start) .. 1 (boundary)
uniform float u_section;    // section-transform pulse 0..1 (decays)
uniform float u_flip;       // section regime sign
uniform float u_drop;       // excitement with bass
uniform float u_buildup;    // excitement without bass
uniform float u_decay;
uniform float u_seed;
uniform float u_rippleAge;  // seconds since last strong kick
uniform float u_rippleAmp;  // that kick's strength
uniform float u_flow;       // liquid inner-flow phase
uniform float u_swell;      // sustained loudness, form size
uniform float u_grain;      // sand-grain gain slider
uniform float u_glass;      // glass-caustic gain slider
uniform float u_bar;        // bar pulse 0..1 (peaks on the downbeat)
uniform float u_rebirth;    // rebirth cross-fade 0..1 (1 = settled)
uniform float u_symmetry;   // genome: base lobe count bias 3..9
uniform float u_gSculpt;    // sculpt gain slider
uniform float u_eqLow;      // dominant deck EQ 0.5 = flat, 0 = kill
uniform float u_eqMid;
uniform float u_eqHigh;
// --- METRIC GROWTH (quantized).
uniform float u_strata;     // integer 0..3: how many strata have assembled
uniform float u_stackKick;  // 0..1 current-bar stack advance from kicks (decays)
uniform float u_matBank;    // integer 0..3 material bank (HARD CUT per phrase)
uniform float u_matCut;     // 0..1 fresh material-cut flash (decays, photosafe)
uniform float u_fracture;   // 0..1 section tectonic fracture/subside (decays)
uniform float u_dropFull;   // 0..1 drop-on-boundary full-relief luminosity
uniform float u_urgency;    // buildup assembly urgency (faster within-step motion)
uniform float u_specHue;    // spectral hue anchor (JS ~1s EMA of centroid) 0..1
uniform float u_hueAnchor;  // DUST FIX v3: per-song genome hue anchor 0..1 (full wheel)
uniform float u_spectrum[24];

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

float fbm(vec2 p) {
  float v = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 5; i++) {
    v += amp * noise(p);
    p = p * 2.02 + vec2(19.7, 7.3);
    amp *= 0.5;
  }
  return v;
}

// EQ region gate: knob 0.5 = flat (1.0 gain), 0 = killed, 1 = boosted.
float eqGate(float knob) {
  return clamp((knob - 0.5) * 2.0 + 1.0, 0.0, 1.7);
}

// SPECTRUM SCULPTURE with QUANTIZED STRATUM REVEAL. Band index maps to
// harmonic order (low = few big lobes, high = many fine ripples). Each band
// belongs to a stratum (0 core .. 3 crest); a band only contributes once its
// stratum has assembled — the reveal is a hard step() against u_strata, so a
// whole shelf of relief pops in ON the bar line (no ease). Kick stacking and
// buildup urgency add sub-step motion WITHIN the current stratum only.
float sculpt(float ang, float r, float t) {
  float disp = 0.0;
  for (int b = 0; b < 24; b++) {
    float fb = float(b);
    float order = u_symmetry + fb * 0.75;
    float g = fb < 8.0 ? u_eqLow : (fb < 16.0 ? u_eqMid : u_eqHigh);
    g = eqGate(g);
    float fall = 1.0 / (1.0 + fb * 0.35);
    // Stratum of this band: 0 core (bins 0..5), 1..2 shelves, 3 crest.
    float stratum = floor(fb / 6.0); // 0,1,2,3
    // HARD reveal: present only when its stratum has assembled. The CURRENT
    // stratum (== u_strata during a bar) fades in via kick-stack + urgency,
    // but earlier strata are fully, discretely present.
    float assembled = step(stratum + 0.5, u_strata + 0.5); // 1 if fully in
    float isCurrent = 1.0 - step(stratum + 0.5, u_strata - 0.5) - assembled;
    isCurrent = clamp(isCurrent, 0.0, 1.0);
    float partial = clamp(0.2 + 0.5 * u_stackKick + 0.4 * u_urgency, 0.0, 1.0);
    float reveal = assembled + isCurrent * partial;
    float ph = t * (0.15 + fb * 0.03) * (1.0 + 0.6 * u_urgency)
      + u_seed * (0.11 + fb * 0.017) + r * (2.0 + fb * 0.6);
    disp += u_spectrum[b] * g * fall * reveal * sin(ang * order + ph);
  }
  return disp;
}

// HSV round-trip for a value-preserving hue rotation. Used to re-anchor the
// material banks' hue families to spectral content (u_specHue) so the palette
// is not a hardcoded blue<->red axis. Value (brightness) is untouched, so the
// change is chroma-only.
vec3 rgb2hsv(vec3 c) {
  vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
  float d = q.x - min(q.w, q.y);
  float e = 1.0e-10;
  return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}
vec3 hsv2rgb(vec3 c) {
  vec3 p = abs(fract(c.xxx + vec3(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0);
  return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y);
}
// Rotate a color's hue by the spectral anchor (chroma-only: value preserved).
vec3 specAnchor(vec3 col) {
  vec3 h = rgb2hsv(col);
  // DUST FIX v3: full-wheel per-song anchor + widened spectral travel, so
  // different songs land the bank family on genuinely different hues.
  h.x = fract(h.x + u_hueAnchor + (u_specHue - 0.5) * 0.8);
  return hsv2rgb(h);
}

// ---- MATERIAL BANKS (hue families; HARD CUT per phrase). Bright, saturated
// (repo dislikes pastels). Each returns a base color from a field coordinate.
vec3 matGlass(float f, float temp) {
  vec3 col = vec3(0.2, 0.55, 1.0) + vec3(0.25, 0.35, 0.3)
    * cos(6.28318 * (vec3(0.9, 1.0, 0.85) * f + vec3(0.55, 0.42, 0.3)));
  return mix(col, vec3(0.5, 0.85, 1.0), 0.3 * temp);
}
vec3 matObsidian(float f, float temp) {
  // Near-black volcanic glass with a cold violet sheen.
  vec3 sheen = vec3(0.35, 0.15, 0.55) + vec3(0.3, 0.2, 0.35)
    * cos(6.28318 * (vec3(1.0, 0.8, 1.0) * f + vec3(0.1, 0.4, 0.7)));
  return sheen * (0.25 + 0.9 * pow(f, 2.0)) + vec3(0.05, 0.02, 0.08);
}
vec3 matOpal(float f, float temp) {
  // Iridescent — the hue TRAVELS wide across the field (rainbow shimmer).
  return vec3(0.5) + vec3(0.5, 0.5, 0.5)
    * cos(6.28318 * (vec3(1.0, 1.0, 1.0) * (f * 2.0) + vec3(0.0, 0.33, 0.67)));
}
vec3 matLava(float f, float temp) {
  // Matte black basalt with molten orange veins in the deep field.
  vec3 crust = vec3(0.08, 0.05, 0.05);
  vec3 molten = vec3(1.0, 0.45, 0.08) + vec3(0.0, 0.3, 0.15)
    * cos(6.28318 * (vec3(1.0, 0.9, 0.7) * f + vec3(0.0, 0.1, 0.2)));
  float vein = pow(f, 3.0);
  return mix(crust, molten, clamp(vein + 0.3 * temp, 0.0, 1.0));
}

// DISCRETE material select: choose the bank == u_matBank (no blend between
// banks — the cut is the aesthetic).
vec3 material(float f, float temp) {
  float b = floor(u_matBank + 0.5);
  vec3 c = matGlass(f, temp);
  c = b > 0.5 ? matObsidian(f, temp) : c;
  c = b > 1.5 ? matOpal(f, temp) : c;
  c = b > 2.5 ? matLava(f, temp) : c;
  // Re-anchor the bank hue family to spectral content (chroma only) so the
  // banks are not a fixed blue<->red axis feeding red/blue feedback dust.
  c = specAnchor(c);
  c *= 1.0 + 0.3 * u_matCut; // the fresh-cut flash brightens (moderate).
  return c;
}

// fringe fix: value-preserving hue ROTATION in YIQ chroma-plane (dust-v3
// idiom). rot is in TURNS; luminance (Y) is untouched by construction.
vec3 hueRotate(vec3 c, float rot) {
  float y = dot(c, vec3(0.299, 0.587, 0.114));
  float i = dot(c, vec3(0.596, -0.274, -0.322));
  float q = dot(c, vec3(0.211, -0.523, 0.312));
  float h = atan(q, i) + rot * 6.28318;
  float chroma = sqrt(i * i + q * q);
  i = chroma * cos(h);
  q = chroma * sin(h);
  return max(vec3(0.0), vec3(
    y + 0.956 * i + 0.621 * q,
    y - 0.272 * i - 0.647 * q,
    y - 1.106 * i - 1.703 * q
  ));
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  float aspect = u_res.x / u_res.y;
  vec2 c = (uv - 0.5) * vec2(aspect, 1.0);
  float r = length(c);
  float ang = atan(c.y, c.x);
  float t = u_time;
  vec2 px = 1.0 / u_res;
  vec2 dir = r > 1e-4 ? c / r : vec2(0.0);

  float mat = clamp(u_material, 0.0, 1.0);

  // ---- Warp / advection of the accumulated material.
  float churnScale = mix(2.4, 7.5, mat);
  float churnSpeed = mix(0.08, 0.9, mat) * (1.0 + 0.8 * u_urgency);
  vec2 churn = (vec2(
    fbm(c * churnScale + u_flow + t * churnSpeed),
    fbm(c * churnScale + vec2(9.1, 4.7) - u_flow - t * churnSpeed)
  ) - 0.5) * mix(0.006, 0.02, mat) * (1.0 + 0.7 * u_midSlow); // motion: slow bands (erratic-motion law)

  // Localized lens swirl (glass refraction hint), continuous.
  float core = 0.16 + 0.12 * u_low + 0.05 * u_swell;
  float lens = (0.3 * u_low + 1.2 * u_kick) * exp(-pow(r / core, 2.0) * 1.5) * (1.0 - 0.6 * mat);
  float dcs = cos(lens * 0.4);
  float dsn = sin(lens * 0.4);
  vec2 w = mat2(dcs, -dsn, dsn, dcs) * c;

  // Traveling kick pressure wave — continuous, solid, lights the medium.
  float waveFront = 0.1 + u_rippleAge * 0.85;
  float rippleWave = exp(-pow((r - waveFront) * 10.0, 2.0)) * exp(-u_rippleAge * 2.2) * u_rippleAmp;
  vec2 ripple = dir * rippleWave * 0.04;

  // Section TECTONIC fracture: a violent radial fold + collapse (fast, solid).
  float fracFold = u_fracture * 0.09 * sin(r * 24.0 - t * 8.0) * u_flip;
  float subside = -u_fracture * 0.05 * (1.0 - smoothstep(0.0, 0.5, r));
  float fold = u_section * 0.06 * sin(r * 20.0 - t * 6.0) * u_flip + fracFold;
  vec2 src = (w + churn + ripple + dir * (fold + subside)) / vec2(aspect, 1.0) + 0.5;

  // Sample previous frame. Glass chromatic split; sand dry. Unsharp tap.
  vec2 ab = dir * (0.0016 + 0.006 * u_drop + 0.01 * rippleWave + 0.006 * u_matCut) * (1.0 - mat)
    / vec2(aspect, 1.0);
  ab *= u_glass; // fringe amount rides the dust param (human note)
  // fringe fix: hue-steerable fringes -- rotate the field to the anchor
  // frame, split channels there, rotate back. Clamped >= 0 (hueRotate can
  // go slightly negative) so the unsharp feedback loop stays stable.
  float fringeRot = u_hueAnchor + (u_specHue - 0.5) * 0.8;
  vec3 tapA = texture2D(u_prev, src + ab).rgb;
  vec3 tapC = texture2D(u_prev, src).rgb;
  vec3 tapB = texture2D(u_prev, src - ab).rgb;
  vec3 sampled = max(vec3(0.0), hueRotate(vec3(
    hueRotate(tapA, -fringeRot).r,
    hueRotate(tapC, -fringeRot).g,
    hueRotate(tapB, -fringeRot).b
  ), fringeRot));
  vec3 blur = (texture2D(u_prev, src + vec2(px.x, 0.0)).rgb
    + texture2D(u_prev, src - vec2(px.x, 0.0)).rgb
    + texture2D(u_prev, src + vec2(0.0, px.y)).rgb
    + texture2D(u_prev, src - vec2(0.0, px.y)).rgb) * 0.25;
  float sharp = mix(1.4, 1.12, mat);
  vec3 field = max(vec3(0.0), sampled * sharp - blur * (sharp - 1.0)) * u_decay;

  // ---- The central organic form.
  // Radius grows with strata (quantized: each stratum widens the shelf),
  // swells with loudness, pulses with the bar.
  float strataN = u_strata / 3.0;
  float formR = 0.16 + 0.11 * strataN + 0.04 * u_phrase + 0.07 * u_swell
    + 0.05 * u_low + 0.03 * u_bar + 0.05 * u_dropFull;
  float surfFreq = mix(3.0, 11.0, mat) * (1.0 + 0.6 * strataN);
  float surfAmp = mix(0.045, 0.11, mat) * (0.5 + 0.7 * strataN);
  float surf = fbm(vec2(ang * surfFreq * 0.5 + u_flow * 0.5, r * surfFreq + t * mix(0.1, 1.4, mat)));
  // The QUANTIZED spectrum sculpture is the dominant shape driver.
  float spec = sculpt(ang, r, t) * u_gSculpt * (0.09 + 0.05 * strataN);
  float rr = r + (surf - 0.5) * surfAmp - spec * u_rebirth;
  float edge = mix(0.02, 0.09, mat) + 0.03 * u_buildup;
  float body = smoothstep(formR + edge, formR - edge, rr);
  float interior = smoothstep(formR, 0.0, rr);

  float temp = clamp(u_centroid, 0.0, 1.0);
  vec3 fresh = vec3(0.0);

  // Field coordinate feeding the material bank.
  float f = clamp(surf * 1.1 + r * 0.4 + t * 0.03, 0.0, 4.0);
  vec3 matCol = material(f, temp);

  // GLASS-style caustic web + wet specular rim (weighted by surface feel).
  float glassW = (1.0 - mat) * u_glass;
  float caustic = pow(abs(sin((surf + fbm(c * 5.0 + u_flow)) * 6.28318 + t * 0.8)), 8.0);
  fresh += matCol * caustic * interior * glassW * (0.6 + 1.4 * u_mid + 0.8 * u_swell);
  float rim = exp(-pow((rr - formR) * 60.0, 2.0));
  vec3 specCol = mix(matCol, vec3(1.0, 0.97, 0.9), 0.4 + 0.4 * temp);
  fresh += specCol * rim * glassW * (0.5 + 1.0 * u_high + 0.6 * u_kick);
  // Sculpted ridges catch extra rim light — embossed QUANTIZED relief.
  fresh += specCol * rim * glassW * abs(spec) * 6.0 * (0.4 + 0.8 * u_high);

  // SAND-style granular scatter.
  float matW = mat * u_grain;
  float g1 = hash(floor(c * mix(90.0, 240.0, u_high) + vec2(fract(u_seed * 0.7131) * 53.0, fract(u_seed * 0.3719) * 37.0)));
  float g2 = hash(floor(c * 150.0 + u_flow * 3.0 + 7.3));
  float grain = pow(max(g1, g2) * (0.4 + 0.6 * surf), 2.2);
  fresh += matCol * grain * body * matW * (0.7 + 1.2 * u_high + 0.9 * u_mid);
  fresh += matCol * grain * body * matW * abs(spec) * 5.0 * (0.5 + 0.9 * u_high);
  float staticN = hash(gl_FragCoord.xy + fract(t * 3.0) * 211.0);
  fresh += matCol * staticN * body * matW * (0.12 + 0.5 * u_high) * (0.5 + 0.5 * mat);

  // Core glow — the heart, pumped by the bar pulse. Full-relief luminosity on
  // a drop-on-boundary (rides max(drop, energy) JS-side).
  float heart = exp(-rr * rr * (12.0 - 6.0 * u_kick) / max(formR, 0.05));
  vec3 heartCol = mix(vec3(0.3, 0.55, 1.0), vec3(1.0, 0.75, 0.4), temp);
  heartCol = mix(heartCol, vec3(1.0, 0.97, 0.9), 0.5 * u_kick + 0.5 * u_dropFull);
  fresh += heartCol * heart * (0.5 + 1.4 * u_low + 1.6 * u_kick + 0.6 * u_bar + 1.4 * u_dropFull);
  // Drop-full internal luminosity: the whole interior lights up.
  fresh += matCol * interior * u_dropFull * 1.2;

  // Section-transform bloom (continuous section pulse).
  vec3 burstCol = mix(matCol, vec3(1.0), 0.4 * u_section);
  float burst = exp(-pow((r - (0.15 + u_section * 0.5)) * 5.0, 2.0));
  fresh += burstCol * burst * u_section * (1.4 + 1.2 * u_drop);

  // TECTONIC fracture shell: a fast crack network expanding as the sculpture
  // subsides — a solid, bright ring marking the section clear.
  float fracR = 0.1 + (1.0 - u_fracture) * 0.6;
  float fracShell = exp(-pow((r - fracR) * 7.0, 2.0)) * u_fracture;
  float crackNet = pow(abs(sin(ang * 9.0 + fbm(c * 8.0) * 6.28318)), 12.0);
  fresh += mix(matCol, vec3(1.0, 0.9, 0.8), 0.4) * fracShell * (1.0 + crackNet) * (1.2 + 1.0 * u_drop);

  // MATERIAL-CUT flash: a brief, moderate expanding shell marking the phrase
  // hard cut to the new material (rate-limited ≤1 per 8-bar phrase — photosafe).
  float cutR = 0.08 + (1.0 - u_matCut) * 0.45;
  float cutShell = exp(-pow((r - cutR) * 6.0, 2.0)) * u_matCut;
  fresh += matCol * cutShell * 1.3;

  // Rebirth dissolve during a track change.
  float rebirthGlow = (1.0 - u_rebirth) * exp(-pow((r - 0.3) * 4.0, 2.0));
  fresh += matCol * rebirthGlow * (1.0 + u_swell);

  // Kick pressure wave LIGHTS the material it crosses (continuous).
  float reverb = 2.4 * rippleWave;
  fresh += matCol * reverb * (0.6 + 0.6 * u_swell) * (body * 0.4 + interior);

  // Inject fresh at (1 - decay); buildups tense-but-alive, drops bloom.
  field += fresh * (1.0 - u_decay) * (3.0 + 1.6 * u_swell + 1.0 * u_drop + 1.2 * u_dropFull);

  // Snare stamp: a mid-transient ring crossing the surface.
  if (u_snare > 0.03) {
    float sarc = exp(-pow((r - formR * 1.15) * 26.0, 2.0))
      * pow(0.5 + 0.5 * sin(ang * 4.0 + u_seed), 2.0);
    field += mix(vec3(0.9, 0.95, 1.0), matCol, 0.5) * sarc * u_snare * 0.8;
  }

  // Whole-frame kick + bar punch — the low-end lands everywhere, solid.
  field *= 1.0 + 0.1 * u_kick + 0.05 * u_bar;

  // Buildups saturate + energize (tense AND vibrant). Cut/fracture add a
  // moderate, rate-limited lift (photosafe, no strobe).
  field *= 0.78 + 0.42 * max(u_drop, u_swell) + 0.12 * u_buildup + 0.28 * u_matCut + 0.25 * u_fracture;

  // Chroma-preserving soft knee (never per-channel clamp).
  float m = max(field.r, max(field.g, field.b));
  if (m > 0.82) {
    field *= (0.82 + 0.18 * (1.0 - exp(-(m - 0.82) * 3.0))) / m;
  }
  gl_FragColor = vec4(max(field, 0.0), 1.0);
}
`,Ee=8,Do=16,Ve=4,Jt=4,Eo=[{id:"material",label:"surface feel (glass↔sand)",min:-.5,max:.5,step:.02,default:0},{id:"sculpt",label:"spectrum sculpt",min:0,max:2,step:.05,default:1},{id:"grain",label:"grain",min:0,max:2,step:.05,default:1},{id:"glass",label:"caustics",min:0,max:2,step:.05,default:1},{id:"persistence",label:"persistence",min:.5,max:2,step:.05,default:1},{id:"cutStrength",label:"cut drama",min:0,max:2,step:.05,default:1}];function Fo(t){let e=t+2654435769|0;return e=Math.imul(e^e>>>16,569420461),e=Math.imul(e^e>>>15,1935289751),e=e^e>>>15,(e>>>0)/4294967296}function bt(t){let e=Math.floor(t)|0;const o=[];for(let r=0;r<4;r++)e=e+1831565813|0,o.push(Fo(e+r*625341585));return[o[0],o[1],o[2],o[3]]}function Ho(t){const e=t.decks.find(r=>r.channel===t.dominantChannel);if(e)return e;let o=null;for(const r of t.decks)r.playing&&(o===null||r.level>o.level)&&(o=r);return o}const qo={id:"g07-materia-metric",name:"g07 materia-metric",hiRes:!0,params:Eo,create:()=>{let t=0,e=999,o=0,r=0,a=0,s=0,i=0,b=0,p=.5,x=0,v=0,u=null,w=0,g=0,k=-1,d=bt(0),_=1,f=!1,n=.5,T=.5,C=.5;const M=new Float32Array(Xt);let c=0,l=0,m=0,P=0,h=0,y=0,S=null,I=null,A=null,E=-999;return ue({fragment:Po,feedback:!0,uniforms:R=>{var ne,pe,fe,ce,ge,ee,de,Z,be,ye,_e,Re,Te;const D=t>0?Math.min(.1,Math.max(0,R.time-t)):.016666666666666666;t=R.time;const H=(ne=R.params.persistence)!=null?ne:1,q=(pe=R.params.material)!=null?pe:0,O=(fe=R.params.cutStrength)!=null?fe:1,W=1-Math.exp(-D/.3),F=Ho(R),z=Math.min(1,Math.max(0,.6*R.flatness+.4*R.spread+q+(d[1]-.5)*.3));a+=(z-a)*W;const L=Math.min(1,Math.max(0,(R.bands.low-.2)/.5));s+=(R.trend.excitement*L-s)*W,i+=(R.trend.excitement*(1-L)-i)*W;const N=Math.min(1,(R.bands.low+R.bands.mid)*.7+s*.4);b+=(N-b)*(1-Math.exp(-D/.5));const G=Math.min(1,(R.bands.low+R.bands.mid+R.bands.high)/2),U=Math.min(1,G*1.4);p+=(R.centroid-p)*(1-Math.exp(-D/1));let B=null,K=-1;for(const Q of R.decks)Q.level>K&&(K=Q.level,B=Q.trackId);B!==null&&B!==u&&(u=B,v=Io(B)),x+=(v-x)*(1-Math.exp(-D/2));const ae=(ce=R.beat)!=null&&ce.bpm?R.beat.bpm/60*Math.PI*2/8:.35;r+=D*ae*(.6+.9*a+.6*i);let J=0;R.beat?J=Math.pow(1-R.beat.barPhase,2.4):J=.5-.5*Math.cos(R.time*1.4);const te=R.beat?(ge=R.beat.ladderBarIndex)!=null?ge:R.beat.barIndex:null;let V=0;if(te!==null){const Q=(te%Ee+Ee)%Ee;V=(Q+(R.beat?R.beat.barPhase:0))/Ee;const xe=Math.floor(te/Ee),We=Math.floor(te/Do);if((S===null||te!==S)&&(c=Math.min(Ve-1,Q),y=0),I!==null&&xe!==I){A!==null&&We!==A?(P=1,g=-g||1,l=(l+2+Math.abs(We)%2)%Jt):(l=(l+1)%Jt,w=1,g=-g||1),c=0,xe-E>=1&&(m=O,E=xe);const me=Math.max(s,.6*U);me>.25&&(c=Ve-1,h=Math.min(1,me))}S=te,I=xe,A=We}else V=.5-.5*Math.cos(R.time*.08),c=Math.min(Ve-1,Math.floor(V*Ee%Ve)),S=null,I=null,A=null;w=Math.max(0,w-D/1.1),P=Math.max(0,P-D/.7),m=Math.max(0,m-D/.5),h=Math.max(0,h-D/1.4),y=Math.max(0,y-D/.6),e+=D,R.impulse.low>.35&&e>.12&&(e=0,o=Math.min(1,R.impulse.low*1.25),y=Math.min(1,y+R.impulse.low*.7));const le=(ee=F==null?void 0:F.trackId)!=null?ee:null,j=le!==null?le:Math.floor((R.centroid*331+R.spread*271+R.flatness*197)*101);f?j!==k&&(k=j,d=bt(j),_=0):(k=j,d=bt(j),_=1,f=!0),_=Math.min(1,_+D/2);const $=1-Math.exp(-D/.15);n+=(((de=F==null?void 0:F.eq.low)!=null?de:.5)-n)*$,T+=(((Z=F==null?void 0:F.eq.mid)!=null?Z:.5)-T)*$,C+=(((be=F==null?void 0:F.eq.high)!=null?be:.5)-C)*$;const oe=R.spectrum;for(let Q=0;Q<Xt;Q++){const xe=Q<oe.length?oe[Q]:0;M[Q]=Math.min(1,Math.max(0,xe))}const he=3+Math.floor(d[0]*7),ie=.99-.008*Math.min(1,(R.bands.low+R.bands.mid+R.bands.high)/2)-.006*i-.004*a;return{u_time:R.time,u_low:R.bands.low,u_mid:R.bands.mid,u_midSlow:((ye=R.bandsSlow)!=null?ye:R.bands).mid,u_high:R.bands.high,u_kick:R.impulse.low,u_snare:R.impulse.mid,u_centroid:R.centroid,u_material:a,u_phrase:Math.min(1,V),u_section:Math.max(0,Math.min(1,w)),u_flip:g||1,u_drop:s,u_buildup:i,u_decay:Math.min(.997,1-(1-ie)/H),u_seed:d[3]*100,u_rippleAge:e,u_rippleAmp:o,u_flow:r,u_swell:b,u_grain:(_e=R.params.grain)!=null?_e:1,u_glass:(Re=R.params.glass)!=null?Re:1,u_bar:J,u_rebirth:_,u_symmetry:he,u_gSculpt:((Te=R.params.sculpt)!=null?Te:1)*(.6+.8*d[2]),u_eqLow:n,u_eqMid:T,u_eqHigh:C,u_strata:c,u_stackKick:Math.min(1,y),u_matBank:l,u_matCut:Math.min(1,m),u_fracture:Math.min(1,P),u_dropFull:Math.min(1,h),u_urgency:Math.min(1,i),u_specHue:p,u_hueAnchor:x,u_spectrum:M}}})}},zo=t=>{let e=Math.floor(Math.abs(t))+2654435769>>>0;return e=Math.imul(e^e>>>16,569420461)>>>0,e=Math.imul(e^e>>>15,1935289751)>>>0,e=(e^e>>>15)>>>0,e/4294967296},Qt=24,Wo=`
precision highp float;
uniform sampler2D u_prev;
uniform vec2 u_res;
uniform float u_time;
uniform float u_low;
uniform float u_mid;
uniform float u_midSlow;    // motion: slow bands (erratic-motion law) — churn advection rate
uniform float u_high;
uniform float u_kick;
uniform float u_snare;
uniform float u_centroid;   // temperature 0 cold .. 1 hot
uniform float u_material;   // 0 liquid glass .. 1 granular sand
uniform float u_phrase;     // phrase growth 0 (start) .. 1 (boundary)
uniform float u_section;    // section-transform pulse 0..1 (decays)
uniform float u_flip;       // section regime sign
uniform float u_drop;       // excitement with bass
uniform float u_buildup;    // excitement without bass
uniform float u_decay;
uniform float u_seed;
uniform float u_rippleAge;  // seconds since last strong kick
uniform float u_rippleAmp;  // that kick's strength
uniform float u_flow;       // liquid inner-flow phase
uniform float u_swell;      // sustained loudness, form size
uniform float u_grain;      // sand-grain gain slider
uniform float u_glass;      // glass-caustic gain slider
uniform float u_bar;        // bar pulse 0..1 (peaks on the downbeat)
uniform float u_rebirth;    // rebirth cross-fade 0..1 (1 = settled)
uniform float u_symmetry;   // genome: base lobe count bias 3..9
uniform float u_gSculpt;    // sculpt gain slider
uniform float u_eqLow;      // dominant deck EQ 0.5 = flat, 0 = kill
uniform float u_eqMid;
uniform float u_eqHigh;
uniform float u_range;      // ARC: eased committed growth stage 0..1
uniform float u_tease;      // ARC: last-bar preview of a pending stage change 0..1
uniform float u_teaseDir;   // ARC: +1 upgrade pending, -1 shed pending, 0 none
uniform float u_stageStep;  // ARC: fresh-commit surge 0..1 (decays)
uniform float u_specHue;    // spectral hue anchor (JS ~1s EMA of centroid) 0..1
uniform float u_hueAnchor;  // DUST FIX v3: per-song genome hue anchor 0..1 (full wheel)
uniform float u_spectrum[24];

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

float fbm(vec2 p) {
  float v = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 5; i++) {
    v += amp * noise(p);
    p = p * 2.02 + vec2(19.7, 7.3);
    amp *= 0.5;
  }
  return v;
}

// EQ region gate: knob 0.5 = flat (1.0 gain), 0 = killed, 1 = boosted.
float eqGate(float knob) {
  return clamp((knob - 0.5) * 2.0 + 1.0, 0.0, 1.7);
}

// SPECTRUM SCULPTURE: sum the 24 bands as angular harmonics. Band index maps
// to harmonic order — low bins few large lobes, high bins many fine ripples.
// ARC: high-order (fine) ripple bands are muted at low range and revealed as
// the form grows, so the seed-crystal reads clean and the drop-form crusty.
float sculpt(float ang, float r, float t) {
  float disp = 0.0;
  for (int b = 0; b < 24; b++) {
    float fb = float(b);
    float order = u_symmetry + fb * 0.75;
    float g = fb < 8.0 ? u_eqLow : (fb < 16.0 ? u_eqMid : u_eqHigh);
    g = eqGate(g);
    float fall = 1.0 / (1.0 + fb * 0.35);
    // Range reveal: low bands always present; fine bands fade in with growth.
    float reveal = clamp(u_range * 1.4 - fb * 0.03, 0.15, 1.0);
    float ph = t * (0.15 + fb * 0.03) + u_seed * (0.11 + fb * 0.017)
      + r * (2.0 + fb * 0.6);
    disp += u_spectrum[b] * g * fall * reveal * sin(ang * order + ph);
  }
  return disp;
}

vec3 hsv2rgb(vec3 c) {
  vec3 p = abs(fract(c.xxx + vec3(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0);
  return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y);
}

// Temperature palette: cold<->hot MATERIAL identity still rides centroid, but
// the two endpoint HUE FAMILIES are now derived from spectral content
// (u_specHue) instead of a hardcoded blue<->red axis. COLD = cool family
// (teal/blue/violet), HOT = its warm complement. Per-endpoint lightness and
// the traveling wobble are preserved (chroma-only change) so the tint still
// TRAVELS with the surface field.
vec3 tempPalette(float t, float temp) {
  // DUST FIX v3: full-wheel cold/hot FAMILIES. The per-song anchor picks
  // the cold family; +0.8*(specHue-0.5) travels it with spectral content;
  // hot stays the complement. Different songs = different cold/hot pair.
  float coldHue = fract(u_hueAnchor + (u_specHue - 0.5) * 0.8 + 0.5);
  float hotHue = fract(coldHue - 0.5);
  vec3 coldRip = vec3(0.2, 0.35, 0.3)
    * cos(6.28318 * (vec3(0.9, 1.0, 0.8) * t + vec3(0.55, 0.42, 0.3)));
  vec3 hotRip = vec3(0.4, 0.35, 0.2)
    * cos(6.28318 * (vec3(1.0, 0.9, 0.7) * t + vec3(0.0, 0.1, 0.2)));
  float coldV = clamp(0.7 + (coldRip.r + coldRip.g + coldRip.b) * 0.33, 0.0, 1.3);
  float hotV = clamp(0.72 + (hotRip.r + hotRip.g + hotRip.b) * 0.33, 0.0, 1.3);
  vec3 cold = hsv2rgb(vec3(coldHue, 0.82, coldV));
  vec3 hot = hsv2rgb(vec3(hotHue, 0.88, hotV));
  return mix(cold, hot, clamp(temp, 0.0, 1.0));
}

// fringe fix: value-preserving hue ROTATION in YIQ chroma-plane (dust-v3
// idiom). rot is in TURNS; luminance (Y) is untouched by construction.
vec3 hueRotate(vec3 c, float rot) {
  float y = dot(c, vec3(0.299, 0.587, 0.114));
  float i = dot(c, vec3(0.596, -0.274, -0.322));
  float q = dot(c, vec3(0.211, -0.523, 0.312));
  float h = atan(q, i) + rot * 6.28318;
  float chroma = sqrt(i * i + q * q);
  i = chroma * cos(h);
  q = chroma * sin(h);
  return max(vec3(0.0), vec3(
    y + 0.956 * i + 0.621 * q,
    y - 0.272 * i - 0.647 * q,
    y - 1.106 * i - 1.703 * q
  ));
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  float aspect = u_res.x / u_res.y;
  vec2 c = (uv - 0.5) * vec2(aspect, 1.0);
  float r = length(c);
  float ang = atan(c.y, c.x);
  float t = u_time;
  vec2 px = 1.0 / u_res;
  vec2 dir = r > 1e-4 ? c / r : vec2(0.0);

  float mat = clamp(u_material, 0.0, 1.0);
  // ARC master: eased committed stage, plus a partial tease of what's coming.
  float rng = clamp(u_range + u_tease * u_teaseDir * 0.22, 0.0, 1.0);

  // ---- Warp / advection of the accumulated material.
  // Churn scales with the arc: seed is near-still, drop-form churns hard.
  float churnScale = mix(2.4, 7.5, mat) * (0.7 + 0.6 * rng);
  float churnSpeed = mix(0.08, 0.9, mat) * (0.25 + 1.4 * rng);
  vec2 churn = (vec2(
    fbm(c * churnScale + u_flow + t * churnSpeed),
    fbm(c * churnScale + vec2(9.1, 4.7) - u_flow - t * churnSpeed)
  ) - 0.5) * mix(0.006, 0.02, mat) * (0.3 + 1.4 * rng) * (1.0 + 0.7 * u_midSlow); // motion: slow bands (erratic-motion law)

  // Localized lens swirl inside the core radius — glass refraction hint.
  float core = 0.16 + 0.12 * u_low + 0.05 * u_swell;
  float lens = (0.3 * u_low + 1.2 * u_kick) * exp(-pow(r / core, 2.0) * 1.5) * (1.0 - 0.6 * mat);
  float dcs = cos(lens * 0.4);
  float dsn = sin(lens * 0.4);
  vec2 w = mat2(dcs, -dsn, dsn, dcs) * c;

  // Traveling kick pressure wave — a solid displacement front that lights.
  float waveFront = 0.1 + u_rippleAge * 0.85;
  float rippleWave = exp(-pow((r - waveFront) * 10.0, 2.0)) * exp(-u_rippleAge * 2.2) * u_rippleAmp;
  vec2 ripple = dir * rippleWave * 0.04;

  // Section transform: a violent radial inversion pulse — space folds. The
  // stage-commit surge borrows this fold so an upgrade physically ERUPTS.
  float stageFold = u_stageStep * u_teaseDir;
  float fold = (u_section + 0.5 * u_stageStep) * 0.06 * sin(r * 20.0 - t * 6.0)
    * (u_flip + stageFold);
  vec2 src = (w + churn + ripple + dir * fold) / vec2(aspect, 1.0) + 0.5;

  // Sample previous frame. Glass chromatic split; sand dry. Unsharp tap.
  vec2 ab = dir * (0.0016 + 0.006 * u_drop + 0.01 * rippleWave) * (1.0 - mat)
    / vec2(aspect, 1.0);
  ab *= u_glass; // fringe amount rides the dust param (human note)
  // fringe fix: hue-steerable fringes -- rotate the field to the anchor
  // frame, split channels there, rotate back. Clamped >= 0 (hueRotate can
  // go slightly negative) so the unsharp feedback loop stays stable.
  float fringeRot = u_hueAnchor + (u_specHue - 0.5) * 0.8;
  vec3 tapA = texture2D(u_prev, src + ab).rgb;
  vec3 tapC = texture2D(u_prev, src).rgb;
  vec3 tapB = texture2D(u_prev, src - ab).rgb;
  vec3 sampled = max(vec3(0.0), hueRotate(vec3(
    hueRotate(tapA, -fringeRot).r,
    hueRotate(tapC, -fringeRot).g,
    hueRotate(tapB, -fringeRot).b
  ), fringeRot));
  vec3 blur = (texture2D(u_prev, src + vec2(px.x, 0.0)).rgb
    + texture2D(u_prev, src - vec2(px.x, 0.0)).rgb
    + texture2D(u_prev, src + vec2(0.0, px.y)).rgb
    + texture2D(u_prev, src - vec2(0.0, px.y)).rgb) * 0.25;
  float sharp = mix(1.4, 1.12, mat);
  vec3 field = max(vec3(0.0), sampled * sharp - blur * (sharp - 1.0)) * u_decay;

  // ---- The central organic form.
  // Radius spans a WIDE arc: seed-crystal tiny, drop-form huge. Still pulses
  // with the bar and swells with loudness, but the arc sets the envelope.
  float formR = mix(0.075, 0.34, rng) + 0.05 * u_phrase * rng
    + 0.06 * u_swell + 0.05 * u_low + 0.03 * u_bar + 0.04 * u_stageStep;
  float surfFreq = mix(3.0, 11.0, mat) * (0.6 + 0.9 * rng) * (1.0 + 0.5 * u_phrase);
  float surfAmp = mix(0.045, 0.11, mat) * (0.35 + 0.9 * rng);
  float surf = fbm(vec2(ang * surfFreq * 0.5 + u_flow * 0.5, r * surfFreq + t * mix(0.1, 1.4, mat) * (0.3 + rng)));
  // SPECTRUM SCULPTURE displacement scales up along the arc.
  float spec = sculpt(ang, r, t) * u_gSculpt * (0.05 + 0.09 * rng);
  float rr = r + (surf - 0.5) * surfAmp - spec * u_rebirth;
  // Edge: seed-crystal crisp/faceted, drop-form molten-soft.
  float edge = mix(0.015, 0.09, mat) + 0.05 * rng + 0.03 * u_buildup;
  float body = smoothstep(formR + edge, formR - edge, rr);
  float interior = smoothstep(formR, 0.0, rr);

  float temp = clamp(u_centroid, 0.0, 1.0);
  vec3 fresh = vec3(0.0);

  // GLASS look: caustic web + wet specular rim. Weighted by (1-mat).
  float glassW = (1.0 - mat) * u_glass;
  float caustic = pow(abs(sin((surf + fbm(c * 5.0 + u_flow)) * 6.28318 + t * 0.8)), 8.0);
  vec3 glassCol = tempPalette(surf * 1.2 + r * 0.4 + t * 0.03, temp);
  fresh += glassCol * caustic * interior * glassW * (0.4 + 1.4 * u_mid + 0.8 * u_swell) * (0.4 + 0.9 * rng);
  float rim = exp(-pow((rr - formR) * 60.0, 2.0));
  vec3 specCol = mix(vec3(0.7, 0.9, 1.0), vec3(1.0, 0.95, 0.85), temp);
  fresh += specCol * rim * glassW * (0.4 + 1.0 * u_high + 0.6 * u_kick);
  // Sculpted ridges catch extra rim light — embossed spectrum relief.
  fresh += specCol * rim * glassW * abs(spec) * 6.0 * (0.4 + 0.8 * u_high);

  // SAND look: granular scatter, dry matte, temperature-tinted.
  float matW = mat * u_grain;
  float g1 = hash(floor(c * mix(90.0, 240.0, u_high) + vec2(fract(u_seed * 0.7131) * 53.0, fract(u_seed * 0.3719) * 37.0)));
  float g2 = hash(floor(c * 150.0 + u_flow * 3.0 + 7.3));
  float grain = pow(max(g1, g2) * (0.4 + 0.6 * surf), 2.2);
  vec3 sandCol = tempPalette(surf * 0.8 + grain * 0.5 + t * 0.02, temp);
  fresh += sandCol * grain * body * matW * (0.5 + 1.2 * u_high + 0.9 * u_mid) * (0.4 + 0.9 * rng);
  fresh += sandCol * grain * body * matW * abs(spec) * 5.0 * (0.5 + 0.9 * u_high);
  float staticN = hash(gl_FragCoord.xy + fract(t * 3.0) * 211.0);
  fresh += sandCol * staticN * body * matW * (0.1 + 0.5 * u_high) * (0.5 + 0.5 * mat) * (0.3 + rng);

  // Core glow — the heart. Seed-crystal keeps a faint cold ember; drop-form
  // burns bright. Pumped by the bar pulse and the stage-commit surge.
  float heart = exp(-rr * rr * (12.0 - 6.0 * u_kick) / max(formR, 0.05));
  vec3 heartCol = mix(vec3(0.3, 0.55, 1.0), vec3(1.0, 0.75, 0.4), temp);
  heartCol = mix(heartCol, vec3(1.0, 0.97, 0.9), 0.5 * u_kick);
  fresh += heartCol * heart * (0.18 + 0.3 * rng + (0.9 + 1.4 * rng) * u_low
    + (1.0 + 1.2 * rng) * u_kick + 0.6 * u_bar + 1.1 * u_stageStep);

  // Section-transform bloom: on the pulse the whole form ERUPTS.
  vec3 burstCol = mix(tempPalette(t * 0.05, temp), vec3(1.0), 0.4 * u_section);
  float burst = exp(-pow((r - (0.15 + u_section * 0.5)) * 5.0, 2.0));
  fresh += burstCol * burst * u_section * (1.2 + 1.2 * u_drop);
  fresh += tempPalette(0.5 + t * 0.04, 1.0 - temp) * interior * u_section * 0.6;

  // STAGE-COMMIT eruption: a bright expanding shell on the phrase boundary
  // where the form steps up (or a collapsing implosion when it sheds).
  float stageFrontR = 0.1 + (1.0 - u_stageStep) * 0.55;
  float stageShell = exp(-pow((r - stageFrontR) * 6.0, 2.0)) * u_stageStep;
  vec3 stageCol = mix(sandCol, glassCol, 1.0 - mat);
  fresh += stageCol * stageShell * (0.9 + 1.3 * rng) * (0.7 + 0.5 * u_teaseDir);

  // Rebirth dissolve during a track change.
  float rebirthGlow = (1.0 - u_rebirth) * exp(-pow((r - 0.3) * 4.0, 2.0));
  fresh += mix(glassCol, sandCol, mat) * rebirthGlow * (1.0 + u_swell);

  // Kick pressure wave LIGHTS the material it crosses.
  float reverb = 2.4 * rippleWave;
  fresh += mix(glassCol, sandCol, mat) * reverb * (0.6 + 0.6 * u_swell) * (body * 0.4 + interior);

  // Inject fresh at (1 - decay). Injection scales with the arc so the seed is
  // dim and restrained while the drop-form blooms — the dynamic-range floor.
  field += fresh * (1.0 - u_decay) * (1.1 + 2.4 * rng + 1.6 * u_swell * rng + 1.0 * u_drop);

  // Snare stamp: a mid-transient ring crossing the surface (kept at all stages).
  if (u_snare > 0.03) {
    float sarc = exp(-pow((r - formR * 1.15) * 26.0, 2.0))
      * pow(0.5 + 0.5 * sin(ang * 4.0 + u_seed), 2.0);
    field += mix(tempPalette(0.15, temp), tempPalette(0.3, temp), 0.5) * sarc * u_snare * (0.5 + 0.5 * rng);
  }

  // Whole-frame kick + bar punch — the low-end lands everywhere, solid.
  field *= 1.0 + (0.06 + 0.1 * rng) * u_kick + 0.05 * u_bar;

  // Temperature grade.
  vec3 grade = tempPalette(0.35, temp);
  field = mix(field, field * (0.45 + grade * 1.4), 0.2);
  // Global brightness floor rides the arc: quiet = dark & restrained, hard =
  // vibrant. Buildups still saturate (tense AND alive), gated by the arc.
  field *= 0.32 + 0.66 * rng + 0.4 * max(u_drop, u_swell) * (0.4 + rng) + 0.12 * u_buildup;

  // Chroma-preserving soft knee (never per-channel clamp).
  float m = max(field.r, max(field.g, field.b));
  if (m > 0.82) {
    field *= (0.82 + 0.18 * (1.0 - exp(-(m - 0.82) * 3.0))) / m;
  }
  gl_FragColor = vec4(max(field, 0.0), 1.0);
}
`,Fe=16,je=5;function Oo(t){let e=t+2654435769|0;return e=Math.imul(e^e>>>16,569420461),e=Math.imul(e^e>>>15,1935289751),e=e^e>>>15,(e>>>0)/4294967296}function xt(t){let e=Math.floor(t)|0;const o=[];for(let r=0;r<4;r++)e=e+1831565813|0,o.push(Oo(e+r*625341585));return[o[0],o[1],o[2],o[3]]}function wt(t){const e=Math.min(1,Math.max(0,t));return e*e*(3-2*e)}const Lo={id:"g04-materia-arc",name:"g04 materia-arc",hiRes:!0,params:[{id:"material",label:"material bias (glass↔sand)",min:-.5,max:.5,step:.02,default:0},{id:"sculpt",label:"spectrum sculpt",min:0,max:2,step:.05,default:1},{id:"grain",label:"sand grain",min:0,max:2,step:.05,default:1},{id:"glass",label:"glass caustics",min:0,max:2,step:.05,default:1},{id:"persistence",label:"persistence",min:.5,max:2,step:.05,default:1},{id:"range",label:"dynamic range",min:0,max:2,step:.05,default:1}],create:()=>{let t=0,e=999,o=0,r=0,a=0,s=0,i=0,b=0,p=.5,x=0,v=0,u=null,w=0,g=0,k=-1,d=-1,_=xt(0),f=1,n=!1,T=.5,C=.5,M=.5;const c=new Float32Array(Qt);let l=0,m=0,P=0,h=0,y=0;return ue({fragment:Wo,feedback:!0,uniforms:S=>{var ge,ee,de,Z,be,ye,_e,Re,Te,Q,xe,We,zt;const I=t>0?Math.min(.1,Math.max(0,S.time-t)):.016666666666666666;t=S.time;const A=(ge=S.params.persistence)!=null?ge:1,E=(ee=S.params.range)!=null?ee:1,R=(de=S.params.material)!=null?de:0,D=1-Math.exp(-I/.3);let H=(Z=S.decks.find(me=>me.channel===S.dominantChannel))!=null?Z:null;if(H===null)for(const me of S.decks)me.playing&&(H===null||me.level>H.level)&&(H=me);const q=Math.min(1,Math.max(0,.6*S.flatness+.4*S.spread+R+(_[1]-.5)*.3));a+=(q-a)*D;const O=Math.min(1,Math.max(0,(S.bands.low-.2)/.5));s+=(S.trend.excitement*O-s)*D,i+=(S.trend.excitement*(1-O)-i)*D;const W=Math.min(1,(S.bands.low+S.bands.mid)*.7+s*.4);b+=(W-b)*(1-Math.exp(-I/.5)),p+=(S.centroid-p)*(1-Math.exp(-I/1));let F=null,z=-1;for(const me of S.decks)me.level>z&&(z=me.level,F=me.trackId);F!==null&&F!==u&&(u=F,v=zo(F)),x+=(v-x)*(1-Math.exp(-I/2));const L=(be=S.beat)!=null&&be.bpm?S.beat.bpm/60*Math.PI*2/8:.35;r+=I*L*(.6+.9*a);let N=0,G=k,U=0,B=0;if(S.beat){const me=(S.beat.barIndex%Fe+Fe)%Fe;N=(me+S.beat.barPhase)/Fe,G=Math.floor(S.beat.barIndex/Fe),U=Math.pow(1-S.beat.barPhase,2.4),me===Fe-1&&(B=S.beat.barPhase)}else{const me=.5-.5*Math.cos(S.time*.08);N=me,U=.5-.5*Math.cos(S.time*1.4),G=Math.floor(S.time*.08/Math.PI),B=Math.max(0,(me-.85)/.15)}const K=Math.min(1,(S.bands.low+S.bands.mid+S.bands.high)/2.2),ae=Math.min(1,(Math.max(s,b)*.75+K*.45+i*.2)*E);P+=(ae-P)*(1-Math.exp(-I/.7));const J=Math.min(je-1,Math.max(0,Math.round(P*(je-1))));B>0&&J!==l?y=J>l?1:-1:B===0&&(y=0),G!==k&&k>=0&&(J>l?(l=Math.min(je-1,l+1),h=1):J<l&&(l=Math.max(0,l-1),h=1),y=0,w=1,g=-g||1),k=G,w=Math.max(0,w-I/1.1),h=Math.max(0,h-I/.6);const te=l/(je-1);m+=(te-m)*(1-Math.exp(-I/.6));const V=wt(m),le=B>0&&y!==0?wt(B):0,j=(ye=H==null?void 0:H.trackId)!=null?ye:null,$=j!==null?j:Math.floor((S.centroid*331+S.spread*271+S.flatness*197)*101);n?$!==d&&(d=$,_=xt($),f=0):(d=$,_=xt($),f=1,n=!0),f=Math.min(1,f+I/2);const oe=1-Math.exp(-I/.15),he=(_e=H==null?void 0:H.eq.low)!=null?_e:.5,se=(Re=H==null?void 0:H.eq.mid)!=null?Re:.5,ie=(Te=H==null?void 0:H.eq.high)!=null?Te:.5;T+=(he-T)*oe,C+=(se-C)*oe,M+=(ie-M)*oe;const ne=S.spectrum;for(let me=0;me<Qt;me++){const Xs=me<ne.length?ne[me]:0;c[me]=Math.min(1,Math.max(0,Xs))}e+=I,S.impulse.low>.35&&e>.12&&(e=0,o=Math.min(1,S.impulse.low*1.25));const pe=3+Math.floor(_[0]*7),ce=.992-.004*Math.min(1,(S.bands.low+S.bands.mid+S.bands.high)/2)-.004*i-.003*a-.006*V;return{u_time:S.time,u_low:S.bands.low,u_mid:S.bands.mid,u_midSlow:((Q=S.bandsSlow)!=null?Q:S.bands).mid,u_high:S.bands.high,u_kick:S.impulse.low,u_snare:S.impulse.mid,u_centroid:S.centroid,u_material:a,u_phrase:Math.min(1,N),u_section:Math.max(0,Math.min(1,w)),u_flip:g||1,u_drop:s,u_buildup:i,u_decay:Math.min(.997,1-(1-ce)/A),u_seed:_[3]*100,u_rippleAge:e,u_rippleAmp:o,u_flow:r,u_swell:b,u_grain:(xe=S.params.grain)!=null?xe:1,u_glass:(We=S.params.glass)!=null?We:1,u_bar:U,u_rebirth:f,u_symmetry:pe,u_gSculpt:((zt=S.params.sculpt)!=null?zt:1)*(.6+.8*_[2]),u_eqLow:T,u_eqMid:C,u_eqHigh:M,u_range:V,u_tease:le,u_teaseDir:y,u_stageStep:wt(h),u_specHue:p,u_hueAnchor:x,u_spectrum:c}}})}},Bo=t=>{let e=Math.floor(Math.abs(t))+2654435769>>>0;return e=Math.imul(e^e>>>16,569420461)>>>0,e=Math.imul(e^e>>>15,1935289751)>>>0,e=(e^e>>>15)>>>0,e/4294967296},Zt=24,No=`
precision highp float;
uniform sampler2D u_prev;
uniform vec2 u_res;
uniform float u_time;
uniform float u_low;
uniform float u_mid;
uniform float u_high;
uniform float u_kick;
uniform float u_snare;
uniform float u_centroid;   // temperature 0 cold .. 1 hot
uniform float u_viscosity;  // 1 mirror-smooth chrome .. 0 boiling droplets
uniform float u_dispersion; // ripple dispersion 0 tight .. 1 broad (spread)
uniform float u_phrase;     // phrase growth 0 (start) .. 1 (boundary)
uniform float u_section;    // section-transform pulse 0..1 (decays)
uniform float u_flip;       // section regime sign (drifts -1..1 across sections)
uniform float u_drop;       // excitement with bass
uniform float u_buildup;    // excitement without bass
uniform float u_decay;
uniform float u_seed;
uniform float u_rippleAge;  // seconds since last strong kick
uniform float u_rippleAmp;  // that kick's strength
uniform float u_flow;       // liquid inner-flow phase
uniform float u_swell;      // sustained loudness, form size
uniform float u_chrome;     // chrome-ridge gain slider
uniform float u_spray;      // mercury-spray (snare powder) gain slider
uniform float u_bar;        // bar pulse 0..1 (peaks on the downbeat)
uniform float u_rebirth;    // rebirth cross-fade 0..1 (1 = settled)
uniform float u_symmetry;   // genome: base lobe count bias 3..9
uniform float u_gSculpt;    // sculpt gain slider
uniform float u_eqLow;      // dominant deck EQ 0.5 = flat, 0 = kill
uniform float u_eqMid;
uniform float u_eqHigh;
uniform float u_specHue;    // spectral hue anchor (JS ~1s EMA of centroid) 0..1
uniform float u_hueAnchor;  // DUST FIX v3: per-song genome hue anchor 0..1 (full wheel)
uniform float u_spectrum[24];

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

float fbm(vec2 p) {
  float v = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 5; i++) {
    v += amp * noise(p);
    p = p * 2.02 + vec2(19.7, 7.3);
    amp *= 0.5;
  }
  return v;
}

// EQ region gate: knob 0.5 = flat (1.0 gain), 0 = killed (0.0), 1 = boosted
// (up to ~1.6). A kill deletes that band's contribution — DENTS the pool.
float eqGate(float knob) {
  return clamp((knob - 0.5) * 2.0 + 1.0, 0.0, 1.7);
}

// SPECTRUM SCULPTURE: sum the 24 bands as angular harmonics. Band index maps
// to harmonic order — low bins are few large lobes, high bins many fine
// ripples. Each band is region-gated by the deck EQ. Constant-loop lookup.
float sculpt(float ang, float r, float t) {
  float disp = 0.0;
  for (int b = 0; b < 24; b++) {
    float fb = float(b);
    // Harmonic order: base symmetry + band index (low = big lobes).
    float order = u_symmetry + fb * 0.75;
    // Region gate: low third -> eqLow, mid third -> eqMid, top third -> eqHigh.
    float g = fb < 8.0 ? u_eqLow : (fb < 16.0 ? u_eqMid : u_eqHigh);
    // Amplitude falls with harmonic order (bass lobes dominate the silhouette).
    float fall = 1.0 / (1.0 + fb * 0.35);
    // Slow phase drift per band (seed-mixed) so the sculpture breathes.
    float ph = t * (0.15 + fb * 0.03) + u_seed * (0.11 + fb * 0.017)
      + r * (2.0 + fb * 0.6);
    disp += u_spectrum[b] * g * fall * sin(ang * order + ph);
  }
  return disp;
}

vec3 hsv2rgb(vec3 c) {
  vec3 p = abs(fract(c.xxx + vec3(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0);
  return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y);
}

// Temperature palette: cold<->hot MATERIAL identity still rides centroid, but
// the two endpoint HUE FAMILIES are now derived from spectral content
// (u_specHue) instead of a hardcoded blue<->red axis. COLD = cool family
// (teal/blue/violet), HOT = its warm complement. Per-endpoint lightness and
// the traveling wobble are preserved (chroma-only change); the mercury borrows
// this so the chrome is TINTED metal, never flat grayscale.
vec3 tempPalette(float t, float temp) {
  // DUST FIX v3: full-wheel cold/hot FAMILIES. The per-song anchor picks
  // the cold family; +0.8*(specHue-0.5) travels it with spectral content;
  // hot stays the complement. Different songs = different cold/hot pair.
  float coldHue = fract(u_hueAnchor + (u_specHue - 0.5) * 0.8 + 0.5);
  float hotHue = fract(coldHue - 0.5);
  vec3 coldRip = vec3(0.2, 0.35, 0.3)
    * cos(6.28318 * (vec3(0.9, 1.0, 0.8) * t + vec3(0.55, 0.42, 0.3)));
  vec3 hotRip = vec3(0.4, 0.35, 0.2)
    * cos(6.28318 * (vec3(1.0, 0.9, 0.7) * t + vec3(0.0, 0.1, 0.2)));
  float coldV = clamp(0.7 + (coldRip.r + coldRip.g + coldRip.b) * 0.33, 0.0, 1.3);
  float hotV = clamp(0.72 + (hotRip.r + hotRip.g + hotRip.b) * 0.33, 0.0, 1.3);
  vec3 cold = hsv2rgb(vec3(coldHue, 0.82, coldV));
  vec3 hot = hsv2rgb(vec3(hotHue, 0.88, hotV));
  return mix(cold, hot, clamp(temp, 0.0, 1.0));
}

// fringe fix: value-preserving hue ROTATION in YIQ chroma-plane (dust-v3
// idiom). rot is in TURNS; luminance (Y) is untouched by construction.
vec3 hueRotate(vec3 c, float rot) {
  float y = dot(c, vec3(0.299, 0.587, 0.114));
  float i = dot(c, vec3(0.596, -0.274, -0.322));
  float q = dot(c, vec3(0.211, -0.523, 0.312));
  float h = atan(q, i) + rot * 6.28318;
  float chroma = sqrt(i * i + q * q);
  i = chroma * cos(h);
  q = chroma * sin(h);
  return max(vec3(0.0), vec3(
    y + 0.956 * i + 0.621 * q,
    y - 0.272 * i - 0.647 * q,
    y - 1.106 * i - 1.703 * q
  ));
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  float aspect = u_res.x / u_res.y;
  vec2 c = (uv - 0.5) * vec2(aspect, 1.0);
  float r = length(c);
  float ang = atan(c.y, c.x);
  float t = u_time;
  vec2 px = 1.0 / u_res;
  vec2 dir = r > 1e-4 ? c / r : vec2(0.0);

  // Mercury "molten" scalar: high when boiling (low viscosity). Reused where
  // the parent used mat (0 = smooth metal, 1 = fragmenting droplets).
  float molten = clamp(1.0 - u_viscosity, 0.0, 1.0);

  // ---- Warp / advection of the accumulated mercury.
  // Smooth chrome: slow sliding sheet. Boiling: fast, fine, jittery churn.
  float churnScale = mix(2.4, 7.5, molten);
  float churnSpeed = mix(0.08, 0.9, molten);
  vec2 churn = (vec2(
    fbm(c * churnScale + u_flow + t * churnSpeed),
    fbm(c * churnScale + vec2(9.1, 4.7) - u_flow - t * churnSpeed)
  ) - 0.5) * mix(0.006, 0.02, molten) * (1.0 + 0.7 * u_mid);

  // Localized lens swirl inside the core radius — surface tension pull.
  float core = 0.16 + 0.12 * u_low + 0.05 * u_swell;
  float lens = (0.3 * u_low + 1.2 * u_kick) * exp(-pow(r / core, 2.0) * 1.5) * (0.4 + 0.6 * u_viscosity);
  float dcs = cos(lens * 0.4);
  float dsn = sin(lens * 0.4);
  vec2 w = mat2(dcs, -dsn, dsn, dcs) * c;

  // Traveling kick pressure wave — a SOLID slam across the pool.
  float waveFront = 0.1 + u_rippleAge * 0.85;
  float rippleWave = exp(-pow((r - waveFront) * 10.0, 2.0)) * exp(-u_rippleAge * 2.2) * u_rippleAmp;
  vec2 ripple = dir * rippleWave * 0.05;

  // Section transform: a violent radial inversion pulse — the pool folds.
  float fold = u_section * 0.06 * sin(r * 20.0 - t * 6.0) * u_flip;
  vec2 src = (w + churn + ripple + dir * fold) / vec2(aspect, 1.0) + 0.5;

  // Sample previous frame. Chrome carries a reflective chromatic split;
  // boiling loses it. Unsharp anti-mush tap keeps chrome ridges crisp.
  vec2 ab = dir * (0.0016 + 0.006 * u_drop + 0.01 * rippleWave) * u_viscosity
    / vec2(aspect, 1.0);
  ab *= u_chrome; // fringe amount rides the dust param (human note)
  // fringe fix: hue-steerable fringes -- rotate the field to the anchor
  // frame, split channels there, rotate back. Clamped >= 0 (hueRotate can
  // go slightly negative) so the unsharp feedback loop stays stable.
  float fringeRot = u_hueAnchor + (u_specHue - 0.5) * 0.8;
  vec3 tapA = texture2D(u_prev, src + ab).rgb;
  vec3 tapC = texture2D(u_prev, src).rgb;
  vec3 tapB = texture2D(u_prev, src - ab).rgb;
  vec3 sampled = max(vec3(0.0), hueRotate(vec3(
    hueRotate(tapA, -fringeRot).r,
    hueRotate(tapC, -fringeRot).g,
    hueRotate(tapB, -fringeRot).b
  ), fringeRot));
  vec3 blur = (texture2D(u_prev, src + vec2(px.x, 0.0)).rgb
    + texture2D(u_prev, src - vec2(px.x, 0.0)).rgb
    + texture2D(u_prev, src + vec2(0.0, px.y)).rgb
    + texture2D(u_prev, src - vec2(0.0, px.y)).rgb) * 0.25;
  // Chrome sharpens (mirror); boiling keeps more blur (froth).
  float sharp = mix(1.12, 1.4, u_viscosity);
  vec3 field = max(vec3(0.0), sampled * sharp - blur * (sharp - 1.0)) * u_decay;

  // ---- The central mercury pool.
  // Radius grows with phrase, swells with loudness, PULSES with the bar.
  float formR = 0.2 + 0.11 * u_phrase + 0.07 * u_swell + 0.05 * u_low
    + 0.03 * u_bar;
  float surfFreq = mix(3.0, 11.0, molten) * (1.0 + 0.6 * u_phrase);
  float surfAmp = mix(0.045, 0.11, molten) * (0.6 + 0.7 * u_phrase);
  float surf = fbm(vec2(ang * surfFreq * 0.5 + u_flow * 0.5, r * surfFreq + t * mix(1.4, 0.1, u_viscosity)));

  // SPECTRUM SCULPTURE: the 24-band displacement field is the dominant
  // shape driver — low bands push large lobes, high bands fine ripples.
  float spec = sculpt(ang, r, t) * u_gSculpt * (0.09 + 0.05 * u_phrase);

  // RIPPLE DISPERSION (spread): concentric standing waves across the pool.
  // Narrow sound -> tight high-frequency waves; wide -> broad interference.
  float rippleFreq = mix(34.0, 9.0, clamp(u_dispersion, 0.0, 1.0));
  float rippleSpeed = mix(3.0, 1.2, clamp(u_dispersion, 0.0, 1.0));
  float standing = sin(r * rippleFreq - t * rippleSpeed + u_flow * 1.5)
    * (0.5 + 0.5 * sin(ang * (2.0 + 6.0 * (1.0 - u_dispersion))));
  float pool = standing * (0.012 + 0.02 * u_mid + 0.02 * u_swell);

  float rr = r + (surf - 0.5) * surfAmp - spec * u_rebirth + pool * u_rebirth;
  // Edge softness: mirror-smooth chrome = crisp meniscus; boiling = ragged.
  float edge = mix(0.02, 0.09, molten) + 0.03 * u_buildup;
  float body = smoothstep(formR + edge, formR - edge, rr);
  float interior = smoothstep(formR, 0.0, rr);

  float temp = clamp(u_centroid, 0.0, 1.0);
  vec3 fresh = vec3(0.0);

  // MERCURY CHROME: mirror-smooth reflective ridges. Weighted by viscosity.
  // A fresnel-ish rim + specular glints ride the standing waves and the
  // spectrum relief; tinted by the traveling palette so it reads as colored
  // liquid metal, never flat gray.
  float chromeW = u_viscosity * u_chrome;
  // Reflective banding: sharp bright/dark chrome stripes off the surface
  // normal proxy (surf + standing + spectrum relief).
  float reflectPhase = (surf * 1.2 + standing * 0.6 + spec * 4.0) * 6.28318 + t * 0.5;
  float chromeBand = pow(abs(sin(reflectPhase)), 6.0);
  vec3 chromeCol = tempPalette(surf * 1.0 + r * 0.5 + t * 0.03, temp);
  fresh += chromeCol * chromeBand * interior * chromeW * (0.6 + 1.2 * u_mid + 0.9 * u_swell);
  // Fresnel meniscus: bright reflective rim where the pool edge catches sky.
  float rim = exp(-pow((rr - formR) * 60.0, 2.0));
  vec3 skyCol = mix(vec3(0.7, 0.9, 1.0), vec3(1.0, 0.95, 0.85), temp);
  fresh += skyCol * rim * chromeW * (0.5 + 1.0 * u_high + 0.6 * u_kick);
  // Specular glints skate along the standing-wave crests (mirror pool).
  float glint = pow(max(0.0, standing), 4.0) * pow(0.5 + 0.5 * chromeBand, 2.0);
  fresh += skyCol * glint * interior * chromeW * (0.4 + 0.9 * u_high) * (0.6 + 0.8 * u_swell);
  // Sculpted ridges catch extra reflection where displacement is steep.
  fresh += skyCol * rim * chromeW * abs(spec) * 6.0 * (0.4 + 0.8 * u_high);

  // BOILING MERCURY: a bubbling froth of fragmenting metal droplets. Weighted
  // by molten (high flatness). Bright hot bead centres, dark valleys.
  float boilW = molten * u_chrome;
  float b1 = hash(floor(c * mix(70.0, 190.0, u_high) + vec2(fract(u_seed * 0.7131) * 53.0, fract(u_seed * 0.3719) * 37.0) + u_flow * 2.0));
  float b2 = fbm(c * mix(8.0, 20.0, u_high) + u_flow * 2.5 + t * 1.6);
  float bead = pow(max(b1, b2) * (0.4 + 0.6 * surf), 1.8);
  vec3 boilCol = tempPalette(surf * 0.8 + bead * 0.5 + t * 0.02, temp);
  fresh += boilCol * bead * body * boilW * (0.7 + 1.2 * u_high + 0.9 * u_mid);
  // Micro-glints on the boiling beads (metal keeps its shine even boiling).
  float boilGlint = pow(bead, 3.0);
  fresh += skyCol * boilGlint * body * boilW * (0.3 + 0.7 * u_high);
  // Sculpted crust: high-band ripples pile beads along the relief crests.
  fresh += boilCol * bead * body * boilW * abs(spec) * 5.0 * (0.5 + 0.9 * u_high);

  // Core glow — the molten heart, hottest at high centroid, bar-pumped.
  float heart = exp(-rr * rr * (12.0 - 6.0 * u_kick) / max(formR, 0.05));
  vec3 heartCol = mix(vec3(0.3, 0.55, 1.0), vec3(1.0, 0.75, 0.4), temp);
  heartCol = mix(heartCol, vec3(1.0, 0.97, 0.9), 0.5 * u_kick);
  fresh += heartCol * heart * (0.5 + 1.4 * u_low + 1.6 * u_kick + 0.6 * u_bar);

  // Section-transform bloom: on the pulse the whole pool ERUPTS.
  vec3 burstCol = mix(tempPalette(t * 0.05, temp), vec3(1.0), 0.4 * u_section);
  float burst = exp(-pow((r - (0.15 + u_section * 0.5)) * 5.0, 2.0));
  fresh += burstCol * burst * u_section * (1.4 + 1.2 * u_drop);
  fresh += tempPalette(0.5 + t * 0.04, 1.0 - temp) * interior * u_section * 0.6;

  // Rebirth dissolve: track change re-genesises the pool; it scatters into
  // droplets and re-coheres (u_rebirth 0 -> 1). Bright spray during transit.
  float rebirthGlow = (1.0 - u_rebirth) * exp(-pow((r - 0.3) * 4.0, 2.0));
  fresh += mix(chromeCol, boilCol, molten) * rebirthGlow * (1.0 + u_swell);

  // Kick pressure wave LIGHTS the mercury it slams across.
  float reverb = 2.4 * rippleWave;
  fresh += mix(chromeCol, boilCol, molten) * reverb * (0.6 + 0.6 * u_swell) * (body * 0.4 + interior);

  // Inject fresh at (1 - decay); buildups tense-but-alive, drops bloom.
  field += fresh * (1.0 - u_decay) * (3.0 + 1.6 * u_swell + 1.0 * u_drop);

  // Snare powder — the BELOVED element, KEPT: fine mercury SPRAY flung off
  // the pool. A mid-transient ring of scattered metal droplets, mid/high
  // gated, tinted by the traveling palette (bright, never red strobe).
  if (u_snare > 0.03) {
    float sarc = exp(-pow((r - formR * 1.15) * 26.0, 2.0))
      * pow(0.5 + 0.5 * sin(ang * 4.0 + u_seed), 2.0);
    // Powder speckle: fine droplet spray riding the ring.
    float spray = hash(gl_FragCoord.xy + fract(t * 4.0) * 149.0);
    float sprayGate = clamp(0.4 * u_mid + 0.6 * u_high, 0.0, 1.0);
    vec3 sprayCol = mix(tempPalette(0.15, temp), tempPalette(0.3, temp), 0.5);
    field += sprayCol * sarc * (0.35 + 0.65 * spray) * u_snare * u_spray
      * (0.5 + 0.9 * sprayGate) * 0.9;
  }

  // Whole-frame kick + bar punch — the low-end lands everywhere, solid.
  field *= 1.0 + 0.1 * u_kick + 0.05 * u_bar;

  // Temperature grade.
  vec3 grade = tempPalette(0.35, temp);
  field = mix(field, field * (0.45 + grade * 1.4), 0.2);
  // Buildups saturate + energize (songprint-spec: tense AND vibrant).
  field *= 0.78 + 0.42 * max(u_drop, u_swell) + 0.12 * u_buildup;

  // Chroma-preserving soft knee (never per-channel clamp).
  float m = max(field.r, max(field.g, field.b));
  if (m > 0.82) {
    field *= (0.82 + 0.18 * (1.0 - exp(-(m - 0.82) * 3.0))) / m;
  }
  gl_FragColor = vec4(max(field, 0.0), 1.0);
}
`,Ne=16;function Go(t){let e=t+2654435769|0;return e=Math.imul(e^e>>>16,569420461),e=Math.imul(e^e>>>15,1935289751),e=e^e>>>15,(e>>>0)/4294967296}function kt(t){let e=Math.floor(t)|0;const o=[];for(let r=0;r<4;r++)e=e+1831565813|0,o.push(Go(e+r*625341585));return[o[0],o[1],o[2],o[3]]}const $o={id:"g05-materia-mercury",name:"g05 materia-mercury",hiRes:!0,params:[{id:"viscosity",label:"viscosity bias (boil↔mirror)",min:-.5,max:.5,step:.02,default:0},{id:"sculpt",label:"spectrum sculpt",min:0,max:2,step:.05,default:1},{id:"chrome",label:"chrome / boil",min:0,max:2,step:.05,default:1},{id:"spray",label:"mercury spray (snare)",min:0,max:2,step:.05,default:1},{id:"persistence",label:"persistence",min:.5,max:2,step:.05,default:1},{id:"growth",label:"phrase growth",min:0,max:2,step:.05,default:1}],create:()=>{let t=0,e=999,o=0,r=0,a=1,s=0,i=0,b=0,p=0,x=.5,v=0,u=0,w=null,g=0,k=0,d=-1,_=-1,f=kt(0),n=1,T=!1,C=.5,M=.5,c=.5;const l=new Float32Array(Zt);return ue({fragment:No,feedback:!0,uniforms:m=>{var j,$,oe,he,se,ie,ne,pe,fe,ce,ge,ee,de;const P=t>0?Math.min(.1,Math.max(0,m.time-t)):.016666666666666666;t=m.time;const h=(j=m.params.persistence)!=null?j:1,y=($=m.params.growth)!=null?$:1,S=(oe=m.params.viscosity)!=null?oe:0,I=1-Math.exp(-P/.3);let A=(he=m.decks.find(Z=>Z.channel===m.dominantChannel))!=null?he:null;if(A===null)for(const Z of m.decks)Z.playing&&(A===null||Z.level>A.level)&&(A=Z);const E=Math.min(1,Math.max(0,1-m.flatness+S-(f[1]-.5)*.3));a+=(E-a)*I;const R=Math.min(1,Math.max(0,m.spread));s+=(R-s)*I;const D=Math.min(1,Math.max(0,(m.bands.low-.2)/.5));i+=(m.trend.excitement*D-i)*I,b+=(m.trend.excitement*(1-D)-b)*I;const H=Math.min(1,(m.bands.low+m.bands.mid)*.7+i*.4);p+=(H-p)*(1-Math.exp(-P/.5)),x+=(m.centroid-x)*(1-Math.exp(-P/1));let q=null,O=-1;for(const Z of m.decks)Z.level>O&&(O=Z.level,q=Z.trackId);q!==null&&q!==w&&(w=q,u=Bo(q)),v+=(u-v)*(1-Math.exp(-P/2));const W=(se=m.beat)!=null&&se.bpm?m.beat.bpm/60*Math.PI*2/8:.35;r+=P*W*(.6+.9*(1-a));let F=0,z=d,L=0;if(m.beat){const Z=(ie=m.beat.ladderBarIndex)!=null?ie:m.beat.barIndex;F=((Z%Ne+Ne)%Ne+m.beat.barPhase)/Ne,z=Math.floor(Z/Ne),L=Math.pow(1-m.beat.barPhase,2.4)}else F=.5-.5*Math.cos(m.time*.08),L=.5-.5*Math.cos(m.time*1.4);F=Math.min(1,F*y),z!==d&&d>=0&&(g=1,k=-k||1),d=z,g=Math.max(0,g-P/1.1);const N=(ne=A==null?void 0:A.trackId)!=null?ne:null,G=N!==null?N:Math.floor((m.centroid*331+m.spread*271+m.flatness*197)*101);T?G!==_&&(_=G,f=kt(G),n=0):(_=G,f=kt(G),n=1,T=!0),n=Math.min(1,n+P/2);const U=1-Math.exp(-P/.15),B=(pe=A==null?void 0:A.eq.low)!=null?pe:.5,K=(fe=A==null?void 0:A.eq.mid)!=null?fe:.5,ae=(ce=A==null?void 0:A.eq.high)!=null?ce:.5;C+=(B-C)*U,M+=(K-M)*U,c+=(ae-c)*U;const J=m.spectrum;for(let Z=0;Z<Zt;Z++){const be=Z<J.length?J[Z]:0;l[Z]=Math.min(1,Math.max(0,be))}e+=P,m.impulse.low>.35&&e>.12&&(e=0,o=Math.min(1,m.impulse.low*1.25));const te=3+Math.floor(f[0]*7),le=.99-.008*Math.min(1,(m.bands.low+m.bands.mid+m.bands.high)/2)-.006*b-.004*(1-a);return{u_time:m.time,u_low:m.bands.low,u_mid:m.bands.mid,u_high:m.bands.high,u_kick:m.impulse.low,u_snare:m.impulse.mid,u_centroid:m.centroid,u_viscosity:a,u_dispersion:s,u_phrase:F,u_section:Math.max(0,Math.min(1,g)),u_flip:k||1,u_drop:i,u_buildup:b,u_decay:Math.min(.997,1-(1-le)/h),u_seed:f[3]*100,u_rippleAge:e,u_rippleAmp:o,u_flow:r,u_swell:p,u_chrome:(ge=m.params.chrome)!=null?ge:1,u_spray:(ee=m.params.spray)!=null?ee:1,u_bar:L,u_rebirth:n,u_symmetry:te,u_gSculpt:((de=m.params.sculpt)!=null?de:1)*(.6+.8*f[2]),u_eqLow:C,u_eqMid:M,u_eqHigh:c,u_specHue:x,u_hueAnchor:v,u_spectrum:l}}})}},Uo=t=>{let e=Math.floor(Math.abs(t))+2654435769>>>0;return e=Math.imul(e^e>>>16,569420461)>>>0,e=Math.imul(e^e>>>15,1935289751)>>>0,e=(e^e>>>15)>>>0,e/4294967296},ea=t=>"vec3("+t[0].toFixed(3)+", "+t[1].toFixed(3)+", "+t[2].toFixed(3)+")",Ko=["precision highp float;","uniform sampler2D u_prev;","uniform vec2 u_res;","uniform float u_time;","uniform float u_low;","uniform float u_mid;","uniform float u_high;","uniform float u_kick;","uniform float u_snare;","uniform float u_centroid;","uniform float u_specHue;","uniform float u_drop;","uniform float u_buildup;","uniform float u_zoom;","uniform float u_rotStep;","uniform float u_decay;","uniform float u_seed;","uniform float u_spawn;","uniform float u_rippleAge;","uniform float u_rippleAmp;","uniform float u_sustain;","uniform float u_armPhase;","uniform float u_dust;","uniform float u_palette;","uniform float u_charge;","uniform float u_spawnSnare;","uniform float u_hueRot;   // DUST FIX v3: per-song hue anchor + slow travel, TURNS 0..1","uniform float u_flareAge;","uniform float u_flareAmp;","uniform float u_flareSeed;","uniform float u_downbeat;","uniform float u_polarity;","","const vec3 LOW = "+ea(re[0])+";","const vec3 HIGH = "+ea(re[2])+";","","float hash(vec2 p) {","  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);","}","","float noise(vec2 p) {","  vec2 i = floor(p);","  vec2 f = fract(p);","  vec2 u = f * f * (3.0 - 2.0 * f);","  return mix(","    mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),","    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),","    u.y","  );","}","","float fbm(vec2 p) {","  float v = 0.0;","  float amp = 0.5;","  for (int i = 0; i < 4; i++) {","    v += amp * noise(p);","    p = p * 2.03 + vec2(17.3, 9.1);","    amp *= 0.5;","  }","  return v;","}","","vec3 pal0(float t) { return vec3(0.42, 0.14, 0.1) + vec3(0.42, 0.24, 0.14) * cos(6.28318 * (vec3(1.0, 0.9, 0.6) * t + vec3(0.0, 0.15, 0.25))); }","vec3 pal1(float t) { return vec3(0.45, 0.28, 0.42) + vec3(0.25, 0.35, 0.5) * cos(6.28318 * (vec3(1.0, 0.85, 0.7) * t + vec3(0.0, 0.2, 0.45))); }","vec3 pal2(float t) { return vec3(0.14, 0.36, 0.32) + vec3(0.3, 0.5, 0.45) * cos(6.28318 * (vec3(0.9, 1.0, 0.8) * t + vec3(0.1, 0.3, 0.5))); }","vec3 pal3(float t) { return vec3(0.5, 0.38, 0.24) + vec3(0.48, 0.42, 0.34) * cos(6.28318 * (vec3(1.0, 0.9, 0.8) * t + vec3(0.0, 0.12, 0.25))); }","","vec3 palette(float t) {","  float x = clamp(u_palette, 0.0, 3.0);","  vec3 c = mix(pal0(t), pal1(t), clamp(x, 0.0, 1.0));","  c = mix(c, pal2(t), clamp(x - 1.0, 0.0, 1.0));","  c = mix(c, pal3(t), clamp(x - 2.0, 0.0, 1.0));","  return c + vec3(0.1, -0.02, -0.05) * u_drop - vec3(0.06, 0.02, -0.04) * u_buildup;","}","","float starShape(vec2 f, float size) {","  float d2 = dot(f, f);","  float core = exp(-d2 * 1100.0 / size);","  float halo = exp(-d2 * 140.0 / size) * 0.2;","  float spikes = (exp(-abs(f.x) * 190.0 / size) * exp(-abs(f.y) * 16.0 / size)","    + exp(-abs(f.y) * 190.0 / size) * exp(-abs(f.x) * 16.0 / size)) * 0.55;","  return core + halo + spikes;","}","","// DUST FIX v3: value-preserving hue ROTATION (YIQ chroma plane). rot in","// TURNS; luminance (Y) untouched so gains are unchanged. Negatives clamped.","vec3 hueRotate(vec3 c, float rot) {","  float y = dot(c, vec3(0.299, 0.587, 0.114));","  float i = dot(c, vec3(0.596, -0.274, -0.322));","  float q = dot(c, vec3(0.211, -0.523, 0.312));","  float h = atan(q, i) + rot * 6.28318;","  float chroma = sqrt(i * i + q * q);","  i = chroma * cos(h);","  q = chroma * sin(h);","  return max(vec3(0.0), vec3(","    y + 0.956 * i + 0.621 * q,","    y - 0.272 * i - 0.647 * q,","    y - 1.106 * i - 1.703 * q","  ));","}","vec3 starScatter(vec2 c, float density, float sizeScale, float gate, float gain) {","  vec2 q = c * density;","  vec2 cell = floor(q);","  vec2 sc = cell + vec2(fract(u_seed * 0.7131) * 61.7, fract(u_seed * 0.3719) * 43.1);","  vec2 pos = vec2(hash(sc + 1.3), hash(sc.yx + 4.7)) * 0.7 + 0.15;","  vec2 f = fract(q) - pos;","  float on = step(gate - 0.09 * u_spawn, hash(sc * 1.618 + 9.7));","  float size = (0.5 + 1.5 * hash(sc.yx * 2.113)) * sizeScale;","  float bright = 0.4 + 0.6 * hash(sc + 17.9);","  vec3 tint = hueRotate(palette(hash(sc.yx + 29.3) * 1.6 + u_time * 0.02), u_hueRot);","  return mix(tint, HIGH, 0.2) * starShape(f, size) * on * bright * gain;","}","","void main() {","  vec2 uv = gl_FragCoord.xy / u_res;","  float aspect = u_res.x / u_res.y;","  vec2 c = (uv - 0.5) * vec2(aspect, 1.0);","  float r = length(c);","  float ang = atan(c.y, c.x);","  float t = u_time;","  vec2 px = 1.0 / u_res;","","  float rot = u_rotStep * (0.35 + 1.4 * exp(-r * 2.2));","  float cs = cos(rot);","  float sn = sin(rot);","  vec2 w = mat2(cs, -sn, sn, cs) * c / u_zoom;","  vec2 dirW = r > 1e-4 ? c / r : vec2(0.0);","  vec2 churn = (vec2(","    fbm(c * 2.6 + t * 0.12),","    fbm(c * 2.6 + vec2(7.7, 3.1) - t * 0.09)","  ) - 0.5) * (0.002 + 0.018 * u_mid + 0.012 * u_buildup);","  float waveFront = 0.16 + u_rippleAge * 0.9;","  float rippleWave = exp(-pow((r - waveFront) * 9.0, 2.0)) * exp(-u_rippleAge * 2.4) * u_rippleAmp;","  vec2 ripple = dirW * rippleWave * 0.035;","  float horizon = (0.14 + 0.1 * u_low) * (1.0 + 0.07 * u_charge);","  float lens = (0.4 * u_low + 1.5 * u_kick) * (1.0 + 0.9 * u_charge) * exp(-pow(r / horizon, 2.0) * 1.4);","  float drag = lens * 0.12;","  float dcs = cos(drag);","  float dsn = sin(drag);","  w = mat2(dcs, -dsn, dsn, dcs) * w;","  vec2 lensPull = dirW * lens * 0.055;","  vec2 src = (w + churn + ripple + lensPull) / vec2(aspect, 1.0) + 0.5;","","  vec2 ab = dirW * (0.0012 + 0.004 * u_drop + 0.003 * u_kick + 0.01 * rippleWave)","    / vec2(aspect, 1.0);","  ab *= u_dust; // fringe amount rides the dust param (human note)","  // fringe fix: hue-steerable fringes -- rotate the field to the anchor","  // frame, split channels there, rotate back. Clamped >= 0 (hueRotate can","  // go slightly negative) so the unsharp feedback loop stays stable.","  float fringeRot = u_hueRot;","  vec3 tapA = texture2D(u_prev, src + ab).rgb;","  vec3 tapC = texture2D(u_prev, src).rgb;","  vec3 tapB = texture2D(u_prev, src - ab).rgb;","  vec3 sampled = max(vec3(0.0), hueRotate(vec3(","    hueRotate(tapA, -fringeRot).r,","    hueRotate(tapC, -fringeRot).g,","    hueRotate(tapB, -fringeRot).b","  ), fringeRot));","  vec3 blur = (texture2D(u_prev, src + vec2(px.x, 0.0)).rgb","    + texture2D(u_prev, src - vec2(px.x, 0.0)).rgb","    + texture2D(u_prev, src + vec2(0.0, px.y)).rgb","    + texture2D(u_prev, src - vec2(0.0, px.y)).rgb) * 0.25;","  vec3 sky = max(vec3(0.0), sampled * 1.35 - blur * 0.35) * u_decay;","","  vec3 fresh = vec3(0.0);","  float volt = (noise(vec2(ang * 14.0 + t * 3.0, t * 22.0)) - 0.5)","    + 0.5 * (noise(vec2(ang * 30.0 - t * 5.0, t * 37.0)) - 0.5);","  float surf = horizon + volt * (0.012 + 0.05 * u_kick + 0.022 * u_low);","","  float bassWarp = u_low * (0.2 * sin(ang * 3.0 + t * 1.7) + 0.13 * sin(ang * 5.0 - t * 2.3))","    + 0.16 * u_kick * sin(ang * 7.0 + t * 9.0)","    + volt * (0.14 * u_low + 0.32 * u_kick);","  float rc = r * (1.0 - bassWarp * exp(-r * 3.0));","  float heart = exp(-rc * rc * (260.0 - 130.0 * u_kick));","  float coronaBody = exp(-rc * (7.0 - 3.0 * u_low));","  float gravity = sin(rc * 46.0 - t * (3.0 + 9.0 * u_low)) * 0.5 + 0.5;","  float gravityGain = u_low * (0.5 + 0.8 * u_kick);","  vec3 gravityColor = hueRotate(palette(0.05 + t * 0.015 + u_specHue * 0.5), u_hueRot);","  fresh += gravityColor","    * pow(gravity, 4.0) * exp(-r * 5.0) * gravityGain;","","  float life = clamp(u_flareAge / 1.0, 0.0, 1.0);","  float riseFall = sin(life * 3.14159265);","  riseFall = pow(riseFall, 0.7);","  float flareEnergy = u_flareAmp * exp(-u_flareAge * 1.6);","  float apexH = (0.10 + 0.30 * u_flareAmp) * riseFall;","  float promo = 0.0;","  float promoHot = 0.0;","  for (int i = 0; i < 3; i++) {","    float fi = float(i);","    float base = u_flareSeed * 6.28318530 + fi * 2.09439510","      + u_polarity * (0.35 + 0.25 * life);","    float span = 0.55 + 0.25 * hash(vec2(u_flareSeed * 13.1 + fi, 7.0));","    float apex = apexH * (0.7 + 0.6 * hash(vec2(fi * 3.7, u_flareSeed * 5.3)));","    float d = ang - base;","    d = mod(d + 3.14159265, 6.28318530) - 3.14159265;","    float s = d / max(span, 0.001);","    if (abs(s) <= 1.0) {","      float lobe = pow(cos(s * 1.5708), 1.4);","      float lineR = surf + apex * lobe;","      float dr = (r - lineR);","      float body = exp(-dr * dr * 900.0);","      float glowW = exp(-dr * dr * 120.0) * 0.5;","      float foot = smoothstep(1.0, 0.55, abs(s));","      promo += (body + glowW) * flareEnergy * (0.55 + 0.6 * foot);","      promoHot += body * flareEnergy * riseFall * (0.4 + 0.9 * foot);","    }","  }","  vec3 promColor = mix(vec3(1.0, 0.35, 0.08), vec3(1.0, 0.72, 0.3), clamp(apexH * 2.5, 0.0, 1.0));","  promColor = mix(promColor, vec3(1.0, 0.95, 0.85), clamp(u_downbeat * riseFall, 0.0, 1.0));","  fresh += promColor * promo * (0.6 + 1.4 * u_kick + 0.8 * u_charge);","  fresh += vec3(1.0, 0.9, 0.75) * promoHot * (0.5 + 1.0 * u_downbeat);","","  float coronaField = fbm(vec2(ang * 5.0 + u_polarity * t * 0.4, (r - surf) * 9.0 - t * 0.6));","  float streamers = 0.5 + 0.5 * sin(ang * 22.0 + u_polarity * t * 1.3 + coronaField * 6.0);","  float coronaBand = exp(-pow((r - surf) * 7.0, 2.0)) + exp(-pow((r - surf * 1.8) * 3.5, 2.0)) * 0.5;","  float coronaGain = (0.12 + 1.3 * u_mid + 0.4 * u_sustain) * (0.4 + 0.6 * coronaField);","  vec3 coronaColor = mix(vec3(1.0, 0.5, 0.15), palette(0.55 + t * 0.02), 0.4);","  fresh += coronaColor * coronaBand * pow(streamers, 2.0) * coronaGain;","","  vec3 coal = palette(0.0 + u_specHue * 0.5) * 0.55;","  fresh += mix(coal, vec3(1.0, 0.8, 0.7), 0.5 * u_kick) * heart * (0.5 + 1.2 * u_low + 1.4 * u_kick);","  fresh += mix(coal, LOW, 0.4) * coronaBody * (0.1 + 0.6 * u_low + 0.35 * u_kick);","  float centerDim = smoothstep(horizon * 0.45, horizon * 1.2, r);","  float streak = exp(-abs(c.y) * 110.0) * exp(-abs(c.x) * (4.5 - 1.5 * u_drop));","  fresh += hueRotate(mix(palette(0.7 + u_specHue * 0.5), palette(t * 0.02), 0.65), u_hueRot) * streak * (0.25 + 1.2 * u_low + 0.8 * u_kick);","","  float arm = sin(ang * 2.0 + log(r + 0.06) * 5.0 - u_armPhase + 0.5 * u_mid * sin(ang * 3.0 + r * 6.0 + t * 0.7));","  float lanes = pow(0.5 + 0.5 * arm, 3.0) * smoothstep(0.06, 0.2, r) * exp(-r * 1.8);","  float cloudField = fbm(vec2(ang * 2.2 + r * 3.0 - t * 0.15, r * 5.0 + t * 0.06));","  float cloud = pow(cloudField, 2.4);","  vec3 diskColor = hueRotate(palette(cloudField * 1.5 + r * 0.35 + ang * 0.1 + t * 0.012 + u_centroid * 0.4 + u_specHue * 0.8), u_hueRot);","  float reverb = 1.0 + 2.6 * rippleWave;","  float midGate = smoothstep(0.04, 0.3, u_mid);","  fresh += diskColor * lanes * (0.1 + 1.2 * u_mid) * (0.5 + cloud) * u_dust * centerDim * midGate * reverb;","  fresh += diskColor * cloud * exp(-r * 2.4) * u_mid * 0.45 * u_dust * centerDim * midGate * reverb;","","  float wisp = fbm(vec2(ang * 6.0 - t * 0.5, r * 10.0 + t * 0.25));","  float shimmer = 0.6 + 0.4 * sin(t * 13.0 + wisp * 24.0);","  vec3 electric = hueRotate(palette(0.35 + cloudField * 1.5 + r * 0.35 + ang * 0.1 + t * 0.012 + u_centroid * 0.4 + u_specHue * 0.8), u_hueRot);","  fresh += electric * pow(wisp, 3.2) * shimmer * smoothstep(0.12, 0.5, r)","    * (0.08 + 1.7 * u_high) * u_dust * reverb;","  sky += fresh * (1.0 - u_decay) * (3.2 + 1.6 * u_sustain);","","  if (u_spawn > 0.01) {","    vec2 sOff = vec2(fract(u_seed * 0.7131) * 21.7, fract(u_seed * 0.3719) * 13.1);","    float puff = pow(fbm(c * 7.0 + sOff), 3.5);","    sky += electric * puff * smoothstep(0.1, 0.4, r) * u_spawn * 0.9;","  }","","  if (u_kick > 0.02) {","    float ringR = 0.1 + 0.05 * u_kick;","    float shock = exp(-pow((r - ringR) * 38.0, 2.0))","      + 0.6 * exp(-pow((r - ringR * 1.7) * 30.0, 2.0));","    sky += mix(palette(0.05 + u_specHue * 0.5), vec3(1.0, 0.9, 0.8), 0.5) * shock * u_kick * (1.15 + 0.8 * u_drop);","    sky *= 1.0 + 0.1 * u_kick;","  }","  if (u_snare > 0.03) {","    float arc = exp(-pow((r - 0.3) * 30.0, 2.0)) * pow(0.5 + 0.5 * sin(ang * 3.0 + u_seed), 2.0);","    sky += palette(0.3 + t * 0.02) * arc * u_snare * 0.7;","  }","  if (u_spawn > 0.003 || u_spawnSnare > 0.003) {","    float reach = smoothstep(0.05, 0.18, r);","    sky += starScatter(c + 11.3, 16.0, 2.8, 0.984, u_spawnSnare * 1.2) * reach","      * mix(vec3(1.0), palette(0.15), 0.45);","  }","","  sky += (hash(gl_FragCoord.xy + fract(t) * 191.0) - 0.5) * (0.012 + 0.02 * u_drop);","","  vec3 grade = palette(0.35 + u_centroid * 0.2);","  sky = mix(sky, sky * (0.4 + grade * 1.5), 0.24);","  sky *= 0.72 + 0.45 * max(u_drop, u_sustain) - 0.05 * u_buildup;","  float m = max(sky.r, max(sky.g, sky.b));","  if (m > 0.8) {","    sky *= (0.8 + 0.2 * (1.0 - exp(-(m - 0.8) * 3.0))) / m;","  }","  gl_FragColor = vec4(max(sky, 0.0), 1.0);","}"].join(`
`),Vo={id:"g03-solar-crown",name:"g03 solar-crown",hiRes:!0,params:[{id:"stars",label:"star density",min:0,max:2,step:.05,default:1.4},{id:"dust",label:"dust amount",min:0,max:2,step:.05,default:1},{id:"palette",label:"palette blend (ember→nebula→aurora→solar)",min:0,max:3,step:.05,default:3},{id:"persistence",label:"persistence",min:.5,max:2,step:.05,default:1},{id:"speed",label:"flight speed",min:.2,max:2.5,step:.05,default:1.4}],create:()=>{let t=0,e=999,o=0,r=0,a=0,s=0,i=0,b=999,p=0,x=0,v=null,u=1,w=1,g=.5,k=0,d=0,_=null;return ue({fragment:Ko,feedback:!0,uniforms:f=>{var q,O,W,F,z,L;const n=t>0?Math.min(.1,Math.max(0,f.time-t)):.016666666666666666;t=f.time;const T=X(f.bands),C=(q=f.params.speed)!=null?q:1.4,M=(O=f.params.persistence)!=null?O:1,c=f.beat,l=Math.min(1,Math.max(0,(f.bands.low-.2)/.5)),m=1-Math.exp(-n/.35);a+=(f.trend.excitement*l-a)*m,s+=(f.trend.excitement*(1-l)-s)*m;const P=a,h=s,y=Math.min(1,T*1.4),S=Math.max(P,.7*y),I=1+(.08+.7*S+3.6*f.impulse.low*(.5+.5*S))*C*n-.3*h*n;r+=n*(c!=null&&c.bpm?c.bpm/60*Math.PI*2/64:.12),i=Math.min(1.4,i*Math.exp(-n/2.5)+f.impulse.low*.28),e+=n,f.impulse.low>.35&&e>.12&&(e=0,o=Math.min(1,f.impulse.low*1.2)),c&&c.barIndex!==null&&(v!==null&&c.barIndex!==v&&(c.barIndex%16+16)%16===0&&(u=-u),v=c.barIndex),w+=(u-w)*(1-Math.exp(-n/.6));const A=c&&c.barPhase!==null?Math.pow(1-Math.min(1,c.barPhase*1.5),2):.3;b+=n,f.impulse.low>.28&&b>.14&&(b=0,p=Math.min(1.4,f.impulse.low*(.8+.9*A)*(.8+.6*Math.max(P,y))),x=(f.time*.618+f.impulse.low*3.1)%1);const E=.992-.008*T-.008*h;g+=(f.centroid-g)*(1-Math.exp(-n/1));let R=null,D=-1;for(const N of f.decks)N.level>D&&(D=N.level,R=N.trackId);R!==null&&R!==_&&(_=R,d=Uo(R)),k+=(d-k)*(1-Math.exp(-n/2));const H=((k+(g-.5)*.8)%1+1)%1;return{u_time:f.time,u_low:f.bands.low,u_mid:f.bands.mid,u_high:f.bands.high,u_kick:f.impulse.low,u_snare:f.impulse.mid,u_centroid:f.centroid,u_specHue:g,u_hueRot:H,u_drop:P,u_buildup:h,u_zoom:I,u_rotStep:(.05+.5*f.bands.mid+.5*h+.25*y)*C*n,u_decay:Math.min(.998,1-(1-E)/M),u_seed:Math.floor(f.time*20),u_rippleAge:e,u_rippleAmp:o,u_sustain:y,u_armPhase:r,u_charge:i,u_dust:(W=f.params.dust)!=null?W:1,u_palette:(F=f.params.palette)!=null?F:3,u_spawn:Math.min(1,1.15*f.impulse.high+.2*f.bands.high)*((z=f.params.stars)!=null?z:1.4)*(.4+.6*Math.max(P,y))/(1+1.8*h)/(1+2.2*f.impulse.low),u_spawnSnare:Math.min(1,.95*f.impulse.mid)*((L=f.params.stars)!=null?L:1.4)*(.5+.5*Math.max(P,y))/(1+.8*h)/(1+2.2*f.impulse.low),u_flareAge:b,u_flareAmp:p,u_flareSeed:x,u_downbeat:A,u_polarity:w}}})}},jo=t=>{let e=Math.floor(Math.abs(t))+2654435769>>>0;return e=Math.imul(e^e>>>16,569420461)>>>0,e=Math.imul(e^e>>>15,1935289751)>>>0,e=(e^e>>>15)>>>0,e/4294967296},ta=t=>"vec3("+t[0].toFixed(3)+", "+t[1].toFixed(3)+", "+t[2].toFixed(3)+")",He=(t,e)=>(t%e+e)%e,Yo=`precision highp float;
uniform sampler2D u_prev;
uniform vec2 u_res;
uniform float u_time;
uniform float u_low;
uniform float u_mid;
uniform float u_high;
uniform float u_kick;
uniform float u_snare;
uniform float u_centroid;
uniform float u_specHue;   // slow-tracked centroid (~1s EMA): dust hue follows spectral content
uniform float u_drop;
uniform float u_buildup;
uniform float u_zoom;
uniform float u_rotStep;
uniform float u_decay;
uniform float u_seed;
uniform float u_spawn;
uniform float u_rippleAge;
uniform float u_rippleAmp;
uniform float u_sustain;
uniform float u_armPhase;
uniform float u_dust;
uniform float u_charge;
uniform float u_spawnSnare;
uniform float u_hueRot;   // DUST FIX v3: per-song hue anchor + slow travel, TURNS 0..1
uniform float u_phrase;    // in-phrase swell 0..1, released on downbeats
uniform float u_spread;    // spectral spread -> disk breadth
uniform float u_flatness;  // spectral flatness -> nebula texture
uniform float u_hue;       // INCOMING season hue center (turns) 0..1
uniform float u_warm;      // INCOMING season warmth 0..1 (cool->warm)
uniform float u_sat;       // INCOMING season saturation breadth 0..1
uniform float u_hueOut;    // OUTGOING season hue center (pre-jump)
uniform float u_warmOut;   // OUTGOING season warmth
uniform float u_satOut;    // OUTGOING season saturation breadth
uniform float u_sweep;     // 0..1 section-front progress (1 = fully arrived)
uniform float u_sweepDir;  // front travel direction (radians)
uniform float u_dropSat;   // trend/drop-gated extra saturation 0..1
uniform float u_dropSlam;  // (A) drop hue-slam 0..1 (plateau ride, phrase ease-back)
uniform float u_pureA;     // (A) regime purest hue #1 (turns)
uniform float u_pureB;     // (A) regime purest hue #2 (turns)

const vec3 LOW = `+ta(re[0])+`;
const vec3 HIGH = `+ta(re[2])+`;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

float fbm(vec2 p) {
  float v = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 4; i++) {
    v += amp * noise(p);
    p = p * 2.03 + vec2(17.3, 9.1);
    amp *= 0.5;
  }
  return v;
}

// HSV -> RGB (bright, fully saturated seasons; no pastel wash).
vec3 hsv2rgb(vec3 c) {
  vec3 p = abs(fract(c.xxx + vec3(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0);
  return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y);
}

// SEASON palette. A season is (hue center, warmth, sat breadth). The
// argument t (the same spatial/phase drive the parent fed palette()) rides
// a hue SPAN around the center so dust/nebula never go monochrome; warmth
// biases the center toward the ember end and lifts value at that end;
// sat breadth widens the span AND the saturation. Value stays parent-like
// (anti-resemblance: chroma is the drama, not luminance).
vec3 seasonColor(float t, float hueC, float warm, float sat) {
  float span = 0.14 + 0.20 * sat;
  // warmth pulls the traveling hue toward warm (0.02..0.10 = red/orange).
  float warmPull = mix(0.0, -0.10, warm);
  float hue = hueC + warmPull + span * sin(6.28318 * t);
  float s = clamp(0.62 + 0.34 * sat + 0.10 * u_dropSat, 0.0, 1.0);
  // Value envelope kept near parent (roughly 0.5..1.0 with the cosine),
  // warmth only nudges it so the change is CHROMATIC not luminance.
  float v = 0.55 + 0.42 * (0.5 + 0.5 * cos(6.28318 * (t + 0.15)));
  v = v * (0.92 + 0.16 * warm);
  return hsv2rgb(vec3(fract(hue), s, clamp(v, 0.0, 1.0)));
}

// The palette() drop-in: same signature the parent used everywhere. Blends
// the OUTGOING and INCOMING seasons by the TRAVELING FRONT. The front is a
// moving line across the field (u_sweepDir), its position set by u_sweep;
// a soft edge makes it read as a sweeping color front, not a hard wipe.
// Between sections u_sweep sits at 1.0 (front fully passed) so incoming ==
// the live season and the whole field is one palette.
vec3 palette(float t) {
  vec3 inc = seasonColor(t, u_hue, u_warm, u_sat);
  vec3 out0 = seasonColor(t, u_hueOut, u_warmOut, u_satOut);
  // Projection of the pixel onto the sweep axis, normalized to ~[-1,1].
  vec2 uv = gl_FragCoord.xy / u_res;
  vec2 pc = (uv - 0.5) * vec2(u_res.x / u_res.y, 1.0);
  vec2 axis = vec2(cos(u_sweepDir), sin(u_sweepDir));
  float proj = dot(pc, axis) * 0.62 + 0.5; // 0 at trailing edge, 1 at leading
  // Front position travels 0 -> 1 with a soft leading edge (width ~0.35).
  float frontPos = u_sweep * 1.35 - 0.175;
  float arrived = smoothstep(frontPos - 0.175, frontPos + 0.175, 1.0 - proj);
  return mix(out0, inc, arrived);
}

float starShape(vec2 f, float size) {
  float d2 = dot(f, f);
  float core = exp(-d2 * 1100.0 / size);
  float halo = exp(-d2 * 140.0 / size) * 0.2;
  float spikes = (exp(-abs(f.x) * 190.0 / size) * exp(-abs(f.y) * 16.0 / size)
    + exp(-abs(f.y) * 190.0 / size) * exp(-abs(f.x) * 16.0 / size)) * 0.55;
  return core + halo + spikes;
}

// DUST FIX v3: value-preserving hue ROTATION (YIQ chroma plane). rot in
// TURNS; luminance (Y) untouched so gains are unchanged. Negatives clamped.
vec3 hueRotate(vec3 c, float rot) {
  float y = dot(c, vec3(0.299, 0.587, 0.114));
  float i = dot(c, vec3(0.596, -0.274, -0.322));
  float q = dot(c, vec3(0.211, -0.523, 0.312));
  float h = atan(q, i) + rot * 6.28318;
  float chroma = sqrt(i * i + q * q);
  i = chroma * cos(h);
  q = chroma * sin(h);
  return max(vec3(0.0), vec3(
    y + 0.956 * i + 0.621 * q,
    y - 0.272 * i - 0.647 * q,
    y - 1.106 * i - 1.703 * q
  ));
}
vec3 starScatter(vec2 c, float density, float sizeScale, float gate, float gain) {
  vec2 q = c * density;
  vec2 cell = floor(q);
  vec2 sc = cell + vec2(fract(u_seed * 0.7131) * 61.7, fract(u_seed * 0.3719) * 43.1);
  vec2 pos = vec2(hash(sc + 1.3), hash(sc.yx + 4.7)) * 0.7 + 0.15;
  vec2 f = fract(q) - pos;
  float on = step(gate - 0.09 * u_spawn, hash(sc * 1.618 + 9.7));
  float size = (0.5 + 1.5 * hash(sc.yx * 2.113)) * sizeScale;
  float bright = 0.4 + 0.6 * hash(sc + 17.9);
  // Star tint samples the OWN neon-season palette at each star hash phase
  // (wide span, spectral-hue biased) instead of a fixed cool/warm ramp.
  // Luminance unchanged (starShape * on * bright * gain).
  vec3 tint = hueRotate(palette(hash(sc.yx + 29.3) * 1.6 + u_time * 0.02 + u_specHue * 0.5), u_hueRot);
  return mix(tint, HIGH, 0.2) * starShape(f, size) * on * bright * gain;
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  float aspect = u_res.x / u_res.y;
  vec2 c = (uv - 0.5) * vec2(aspect, 1.0);
  float r = length(c);
  float ang = atan(c.y, c.x);
  float t = u_time;
  vec2 px = 1.0 / u_res;

  // ---- Warp: differential rotation + churn + traveling kick ripple.
  float twist = 1.0 + 0.12 * u_phrase;
  float rot = u_rotStep * (0.35 + 1.4 * exp(-r * 2.2)) * twist;
  float cs = cos(rot);
  float sn = sin(rot);
  vec2 w = mat2(cs, -sn, sn, cs) * c / u_zoom;
  vec2 dirW = r > 1e-4 ? c / r : vec2(0.0);
  vec2 churn = (vec2(
    fbm(c * 2.6 + t * 0.12),
    fbm(c * 2.6 + vec2(7.7, 3.1) - t * 0.09)
  ) - 0.5) * (0.002 + 0.018 * u_mid + 0.012 * u_buildup);
  float waveFront = 0.16 + u_rippleAge * 0.9;
  float rippleWave = exp(-pow((r - waveFront) * 9.0, 2.0)) * exp(-u_rippleAge * 2.4) * u_rippleAmp;
  vec2 ripple = dirW * rippleWave * 0.035;
  float horizon = (0.14 + 0.1 * u_low) * (1.0 + 0.07 * u_charge);
  float lens = (0.4 * u_low + 1.5 * u_kick) * (1.0 + 0.9 * u_charge) * exp(-pow(r / horizon, 2.0) * 1.4);
  float drag = lens * 0.12;
  float dcs = cos(drag);
  float dsn = sin(drag);
  w = mat2(dcs, -dsn, dsn, dcs) * w;
  vec2 lensPull = dirW * lens * 0.055;
  vec2 src = (w + churn + ripple + lensPull) / vec2(aspect, 1.0) + 0.5;

  // Chromatic aberration.
  vec2 ab = dirW * (0.0012 + 0.004 * u_drop + 0.003 * u_kick + 0.01 * rippleWave)
    / vec2(aspect, 1.0);
  ab *= u_dust; // fringe amount rides the dust param (human note)
  // fringe fix: hue-steerable fringes -- rotate the field to the anchor
  // frame, split channels there, rotate back. Clamped >= 0 (hueRotate can
  // go slightly negative) so the unsharp feedback loop stays stable.
  float fringeRot = u_hueRot;
  vec3 tapA = texture2D(u_prev, src + ab).rgb;
  vec3 tapC = texture2D(u_prev, src).rgb;
  vec3 tapB = texture2D(u_prev, src - ab).rgb;
  vec3 sampled = max(vec3(0.0), hueRotate(vec3(
    hueRotate(tapA, -fringeRot).r,
    hueRotate(tapC, -fringeRot).g,
    hueRotate(tapB, -fringeRot).b
  ), fringeRot));
  vec3 blur = (texture2D(u_prev, src + vec2(px.x, 0.0)).rgb
    + texture2D(u_prev, src - vec2(px.x, 0.0)).rgb
    + texture2D(u_prev, src + vec2(0.0, px.y)).rgb
    + texture2D(u_prev, src - vec2(0.0, px.y)).rgb) * 0.25;
  vec3 sky = max(vec3(0.0), sampled * 1.35 - blur * 0.35) * u_decay;

  // ---- Steady layers, injected at (1 - decay).
  vec3 fresh = vec3(0.0);
  float volt = (noise(vec2(ang * 14.0 + t * 3.0, t * 22.0)) - 0.5)
    + 0.5 * (noise(vec2(ang * 30.0 - t * 5.0, t * 37.0)) - 0.5);
  float bassWarp = u_low * (0.2 * sin(ang * 3.0 + t * 1.7) + 0.13 * sin(ang * 5.0 - t * 2.3))
    + 0.16 * u_kick * sin(ang * 7.0 + t * 9.0)
    + volt * (0.14 * u_low + 0.32 * u_kick);
  float rc = r * (1.0 - bassWarp * exp(-r * 3.0));
  float heart = exp(-rc * rc * (260.0 - 130.0 * u_kick));
  float corona = exp(-rc * (7.0 - 3.0 * u_low));
  float gravity = sin(rc * 46.0 - t * (3.0 + 9.0 * u_low)) * 0.5 + 0.5;
  float gravityGain = u_low * (0.5 + 0.8 * u_kick);
  // Gravity ripple color: a slice of the OWN neon-season palette (spectral-hue
  // biased) instead of a fixed ember/LOW mix. Gain unchanged.
  vec3 gravityColor = hueRotate(palette(0.05 + t * 0.015 + u_specHue * 0.5), u_hueRot);
  fresh += gravityColor
    * pow(gravity, 4.0) * exp(-r * 5.0) * gravityGain;
  float arcJitter = volt * (0.012 + 0.05 * u_kick + 0.022 * u_low);
  float ringGlow = exp(-pow((r - horizon - arcJitter) * 52.0, 2.0));
  float ringCore = exp(-pow((r - horizon - arcJitter) * 210.0, 2.0));
  float bassOn = smoothstep(0.06, 0.3, u_low);
  // Ring color: a neon-season palette slice (spectral-hue biased) charging
  // toward a wide phase offset then white-hot at high charge. Palette supplies
  // hue; the charge->white ramp and gains preserve luminance.
  vec3 chargeColor = mix(palette(0.02 + u_specHue * 0.5), palette(0.12 + u_specHue * 0.5), clamp(u_charge, 0.0, 1.0));
  chargeColor = mix(chargeColor, vec3(1.0, 0.97, 0.92), clamp(u_charge - 0.6, 0.0, 0.4) * 2.5);
  fresh += chargeColor * ringGlow * (0.12 + 0.6 * u_low + 1.1 * u_kick + 0.5 * u_charge);
  fresh += mix(chargeColor, vec3(1.0), 0.5 * u_kick) * ringCore
    * (0.3 + 1.3 * bassOn + 2.4 * u_kick + 0.8 * u_charge);
  // Coal heart: a deep, low-luma slice of the OWN neon-season palette (spectral-
  // hue biased) instead of a fixed dark red. Kept dark (0.55 floor); gains/kick-
  // whiten preserve luminance.
  vec3 coal = palette(0.0 + u_specHue * 0.5) * 0.55;
  fresh += mix(coal, vec3(1.0, 0.8, 0.7), 0.5 * u_kick) * heart * (0.5 + 1.2 * u_low + 1.4 * u_kick);
  fresh += mix(coal, LOW, 0.4) * corona * (0.1 + 0.6 * u_low + 0.35 * u_kick);
  float centerDim = smoothstep(horizon * 0.45, horizon * 1.2, r);
  float streak = exp(-abs(c.y) * 110.0) * exp(-abs(c.x) * (4.5 - 1.5 * u_drop));
  // Streak: both ends sample the OWN neon-season palette (a wide phase offset
  // for the cool end, spectral-hue biased) instead of a fixed steel-blue.
  fresh += hueRotate(mix(palette(0.7 + u_specHue * 0.5), palette(t * 0.02), 0.65), u_hueRot) * streak * (0.25 + 1.2 * u_low + 0.8 * u_kick);
  // The disk: spiral lanes + clouds in the SEASON palette (front-swept).
  float breadth = mix(2.6, 1.15, clamp(u_spread, 0.0, 1.0));
  float bandGain = mix(1.35, 0.85, clamp(u_spread, 0.0, 1.0));
  float arm = sin(ang * 2.0 + log(r + 0.06) * 5.0 - u_armPhase + 0.5 * u_mid * sin(ang * 3.0 + r * 6.0 + t * 0.7));
  float lanes = pow(0.5 + 0.5 * arm, 3.0) * smoothstep(0.06, 0.2, r) * exp(-r * breadth) * bandGain;
  float cloudField = fbm(vec2(ang * 2.2 + r * 3.0 - t * 0.15, r * 5.0 + t * 0.06));
  float cloud = pow(cloudField, 2.4);
  // SPECTRAL DUST TINT: the disk palette phase is biased by the slow-tracked
  // centroid (u_specHue, ~1s EMA) so dust hue follows spectral content.
  vec3 diskColor = hueRotate(palette(cloudField * 1.5 + r * 0.35 + ang * 0.1 + t * 0.012 + u_centroid * 0.4 + u_specHue * 0.8), u_hueRot);
  float reverb = 1.0 + 2.6 * rippleWave;
  float midGate = smoothstep(0.04, 0.3, u_mid);
  float phraseSwell = 1.0 + 0.22 * u_phrase;
  fresh += diskColor * lanes * (0.1 + 1.2 * u_mid) * (0.5 + cloud) * u_dust * centerDim * midGate * reverb * phraseSwell;
  fresh += diskColor * cloud * exp(-r * mix(2.4, 1.4, clamp(u_spread, 0.0, 1.0))) * u_mid * 0.45 * u_dust * centerDim * midGate * reverb * phraseSwell;
  // HIGH NEBULA: finer, counter-rotating, electric — season-tinted.
  float wisp = fbm(vec2(ang * 6.0 - t * 0.5, r * 10.0 + t * 0.25));
  float shimmer = 0.6 + 0.4 * sin(t * 13.0 + wisp * 24.0);
  float silky = mix(4.0, 2.4, clamp(u_flatness, 0.0, 1.0));
  float grain = mix(1.0, 0.55 + 0.9 * hash(gl_FragCoord.xy + fract(t) * 53.0), clamp(u_flatness, 0.0, 1.0));
  vec3 electric = hueRotate(mix(palette(0.85 + u_specHue * 0.5), palette(0.6 + t * 0.03 + u_specHue * 0.5), 0.65), u_hueRot);
  fresh += electric * pow(wisp, silky) * shimmer * grain * smoothstep(0.12, 0.5, r)
    * (0.08 + 1.7 * u_high) * u_dust * reverb;
  // (B) KICK RIPPLE NEON EDGE-LIGHT: a thin, blazing, fast neon line in the
  // regime hue, riding the same traveling wavefront but MUCH tighter (a thin
  // edge, not a soft wave) and additively bright, so a kick throws a racing
  // electric edge across the field. Localized spatial front (photosensitivity
  // floor: not a full-field flash).
  float neonEdge = exp(-pow((r - waveFront) * 46.0, 2.0)) * exp(-u_rippleAge * 2.4) * u_rippleAmp;
  vec3 neonHue = seasonColor(0.0, u_pureA, 0.0, 1.0);
  fresh += neonHue * neonEdge * (1.6 + 2.4 * u_kick);
  sky += fresh * (1.0 - u_decay) * (3.2 + 1.6 * u_sustain);

  // High-transient nebula PUFFS.
  if (u_spawn > 0.01) {
    vec2 sOff = vec2(fract(u_seed * 0.7131) * 21.7, fract(u_seed * 0.3719) * 13.1);
    float puff = pow(fbm(c * 7.0 + sOff), 3.5);
    sky += electric * puff * smoothstep(0.1, 0.4, r) * u_spawn * 0.9;
  }

  // ---- Transient stamps (kick response stays SOLID).
  if (u_kick > 0.02) {
    float ringR = 0.1 + 0.05 * u_kick;
    float shock = exp(-pow((r - ringR) * 38.0, 2.0))
      + 0.6 * exp(-pow((r - ringR * 1.7) * 30.0, 2.0));
    // Shockwave hue from the OWN neon-season palette (spectral-hue biased)
    // mixed toward a warm-white accent. Kick gain / drop scaling unchanged.
    sky += mix(palette(0.05 + u_specHue * 0.5), vec3(1.0, 0.9, 0.8), 0.5) * shock * u_kick * (1.15 + 0.8 * u_drop);
    sky *= 1.0 + 0.1 * u_kick;
  }
  if (u_snare > 0.03) {
    float arc = exp(-pow((r - 0.3) * 30.0, 2.0)) * pow(0.5 + 0.5 * sin(ang * 3.0 + u_seed), 2.0);
    sky += palette(0.3 + t * 0.02) * arc * u_snare * 0.7;
  }
  if (u_spawn > 0.003 || u_spawnSnare > 0.003) {
    float reach = smoothstep(0.05, 0.18, r);
    sky += starScatter(c + 11.3, 16.0, 2.8, 0.984, u_spawnSnare * 1.2) * reach
      * mix(vec3(1.0), palette(0.15), 0.45);
  }

  // Film grain.
  sky += (hash(gl_FragCoord.xy + fract(t) * 191.0) - 0.5) * (0.012 + 0.02 * u_drop);

  // Season grade: lean the whole frame toward the (front-swept) season hue,
  // so the chromatic drama is legible even while bass-red owns the center.
  vec3 grade = palette(0.35 + u_centroid * 0.2);
  sky = mix(sky, sky * (0.4 + grade * 1.5), 0.24);
  // (A) DROP HUE SLAM: on a drop plateau, slam the whole field toward the
  // regime two PUREST hues (spatially split so it stays legible, not flat),
  // easing back over the phrase. CHROMA-only: the field keeps its own
  // luminance, only its hue is dragged toward the pure pair (per-pixel scale
  // by the frame luminance so blacks stay black -> deeper neon contrast).
  float lum = max(sky.r, max(sky.g, sky.b));
  float split = smoothstep(-0.15, 0.15, dot((uv - 0.5), vec2(cos(u_sweepDir), sin(u_sweepDir))));
  float pureHue = mix(u_pureA, u_pureB, split);
  vec3 pure = seasonColor(0.0, pureHue, 0.0, 1.0) * lum;
  sky = mix(sky, pure, 0.55 * u_dropSlam);
  // Luminance envelope kept PARENT-LIKE (anti-resemblance: chroma is the
  // drama). No section-boundary brightness flash.
  sky *= 0.72 + 0.45 * max(u_drop, u_sustain) - 0.05 * u_buildup;
  // Chroma-preserving soft knee (never per-channel clamp).
  float m = max(sky.r, max(sky.g, sky.b));
  if (m > 0.8) {
    sky *= (0.8 + 0.2 * (1.0 - exp(-(m - 0.8) * 3.0))) / m;
  }
  gl_FragColor = vec4(max(sky, 0.0), 1.0);
}
`,Ye=[{hue:.5,warm:.1,sat:.95},{hue:.3,warm:.15,sat:.9},{hue:.9,warm:.35,sat:.95},{hue:.1,warm:.85,sat:.85}],Xo=[.5,.3,.9,.1],Jo=[.87,.78,.58,.47],Qo={id:"g07-seasons-neon",name:"g07 seasons-neon",hiRes:!0,params:[{id:"stars",label:"star density",min:0,max:2,step:.05,default:1},{id:"dust",label:"dust amount",min:0,max:2,step:.05,default:1},{id:"seasonDrift",label:"season drift (in-phrase hue turn)",min:0,max:2,step:.05,default:1},{id:"sweepSpeed",label:"section sweep speed",min:.3,max:3,step:.05,default:1},{id:"persistence",label:"persistence",min:.5,max:2,step:.05,default:1},{id:"speed",label:"flight speed",min:.2,max:2.5,step:.05,default:1}],create:()=>{let t=0,e=999,o=0,r=0,a=0,s=0,i=0,b=null,p=0,x=0,v=0,u=0,w=.5,g=0,k=0,d=null,_=0;const f={...Ye[0]},n={...Ye[0]};let T=1,C=0,M=null;return ue({fragment:Yo,feedback:!0,uniforms:c=>{var se,ie,ne,pe,fe,ce,ge,ee,de,Z,be,ye;const l=t>0?Math.min(.1,Math.max(0,c.time-t)):.016666666666666666;t=c.time;const m=X(c.bands),P=(se=c.bandsSlow)!=null?se:c.bands,h=(ie=c.params.speed)!=null?ie:1,y=(ne=c.params.persistence)!=null?ne:1,S=(pe=c.params.seasonDrift)!=null?pe:1,I=(fe=c.params.sweepSpeed)!=null?fe:1,A=Math.min(1,Math.max(0,(c.bands.low-.2)/.5)),E=1-Math.exp(-l/.35);a+=(c.trend.excitement*A-a)*E,s+=(c.trend.excitement*(1-A)-s)*E;const R=a,D=s,H=Math.min(1,m*1.4),q=Math.max(R,.7*H),O=1+(.08+.7*q+3.6*c.impulse.low*(.5+.5*q))*h*l-.3*D*l;r+=l*((ce=c.beat)!=null&&ce.bpm?c.beat.bpm/60*Math.PI*2/64:.12),i=Math.min(1.4,i*Math.exp(-l/2.5)+c.impulse.low*.28),e+=l,c.impulse.low>.35&&e>.12&&(e=0,o=Math.min(1,c.impulse.low*1.2));const W=c.beat,F=W?(ge=W.ladderBarIndex)!=null?ge:W.barIndex:null;let z;if(W&&F!==null?(b!==null&&F!==b&&He(F,4)===0&&(p=0),z=(He(F,4)+W.barPhase)/4):z=.5+.5*Math.sin(c.time*.35),p+=(z-p)*(1-Math.exp(-l/.5)),W&&F!==null){const _e=Math.floor(F/16);if(M===null)M=_e;else if(_e!==M){M=_e,n.hue=f.hue,n.warm=f.warm,n.sat=f.sat;const Re=1+He(_e,3);_=He(_+Re,Ye.length),C=He(_e*1.7,Math.PI*2),T=0}}T=Math.min(1,T+l*1.6*I);const L=Ye[_],N=Math.sin(p*Math.PI*2)*.03*S,G=.08*S*Math.sin(p*Math.PI),U=.06*S*(.5+.5*Math.cos(p*Math.PI*2)),B=L.hue+N,K=Math.min(1,Math.max(0,L.warm+G)),ae=Math.min(1,Math.max(0,L.sat+U)),J=1-Math.exp(-l/.25);let te=B-f.hue;te-=Math.round(te),f.hue=He(f.hue+te*J,1),f.warm+=(K-f.warm)*J,f.sat+=(ae-f.sat)*J;const V=Math.min(1,Math.max(R,.6*H)),le=Math.min(1,Math.max(R,.55*H))*(1-.7*p);u+=(le-u)*(1-Math.exp(-l/.3));const j=.992-.008*m-.008*D;W&&F!==null&&(b=F),x+=(((ee=c.spread)!=null?ee:0)-x)*(1-Math.exp(-l/.4)),v+=(((de=c.flatness)!=null?de:0)-v)*(1-Math.exp(-l/.4)),w+=(c.centroid-w)*(1-Math.exp(-l/1));let $=null,oe=-1;for(const _e of c.decks)_e.level>oe&&(oe=_e.level,$=_e.trackId);$!==null&&$!==d&&(d=$,k=jo($)),g+=(k-g)*(1-Math.exp(-l/2));const he=((g+(w-.5)*.8)%1+1)%1;return{u_time:c.time,u_low:c.bands.low,u_mid:c.bands.mid,u_high:c.bands.high,u_kick:c.impulse.low,u_snare:c.impulse.mid,u_centroid:c.centroid,u_specHue:w,u_hueRot:he,u_drop:R,u_buildup:D,u_zoom:O,u_rotStep:(.05+.5*P.mid+.5*D+.25*H)*h*l,u_decay:Math.min(.998,1-(1-j)/y),u_seed:Math.floor(c.time*20),u_rippleAge:e,u_rippleAmp:o,u_sustain:H,u_armPhase:r,u_charge:i,u_dust:(Z=c.params.dust)!=null?Z:1,u_spawn:Math.min(1,1.15*c.impulse.high+.2*c.bands.high)*((be=c.params.stars)!=null?be:1)*(.4+.6*Math.max(R,H))/(1+1.8*D)/(1+2.2*c.impulse.low),u_spawnSnare:Math.min(1,.95*c.impulse.mid)*((ye=c.params.stars)!=null?ye:1)*(.5+.5*Math.max(R,H))/(1+.8*D)/(1+2.2*c.impulse.low),u_phrase:Math.min(1,Math.max(0,p)),u_spread:Math.min(1,Math.max(0,x)),u_flatness:Math.min(1,Math.max(0,v)),u_hue:f.hue,u_warm:Math.min(1,Math.max(0,f.warm)),u_sat:Math.min(1,Math.max(0,f.sat)),u_hueOut:n.hue,u_warmOut:Math.min(1,Math.max(0,n.warm)),u_satOut:Math.min(1,Math.max(0,n.sat)),u_sweep:Math.min(1,Math.max(0,T)),u_sweepDir:C,u_dropSat:V,u_dropSlam:Math.min(1,Math.max(0,u)),u_pureA:Xo[_],u_pureB:Jo[_]}}})}},Zo=t=>{let e=Math.floor(Math.abs(t))+2654435769>>>0;return e=Math.imul(e^e>>>16,569420461)>>>0,e=Math.imul(e^e>>>15,1935289751)>>>0,e=(e^e>>>15)>>>0,e/4294967296},aa=t=>"vec3("+t[0].toFixed(3)+", "+t[1].toFixed(3)+", "+t[2].toFixed(3)+")",er=`
precision highp float;
uniform sampler2D u_prev;
uniform vec2 u_res;
uniform float u_time;
uniform float u_low;
uniform float u_mid;
uniform float u_high;
uniform float u_kick;
uniform float u_snare;
uniform float u_centroid;  // harmonic content: palette phase
uniform float u_specHue;   // slow-tracked centroid (~1s EMA): dust hue follows spectral content
uniform float u_drop;      // excitement WITH bass
uniform float u_buildup;   // excitement WITHOUT bass
uniform float u_zoom;
uniform float u_rotStep;
uniform float u_decay;
uniform float u_seed;
uniform float u_spawn;
uniform float u_rippleAge;  // seconds since the last strong kick
uniform float u_rippleAmp;  // that kick's captured strength
uniform float u_sustain;    // bass-weighted sustained loudness
uniform float u_armPhase;   // spiral-arm drift, BPM-locked when gridded
uniform float u_dust;       // disk cloud / fine-dust gain
uniform float u_palette;    // palette bank 0..3 (QUANTIZED — integer per look)
uniform float u_charge;     // bass-ring charge (accumulated kick energy)
uniform float u_spawnSnare; // snare-driven star burst gain
// --- QUANTIZED LOOK TUPLE (all discrete; cut hard at phrase boundaries).
uniform float u_arms;       // spiral-arm count, integer {2,3,5,7}
uniform float u_ringOn;     // 0/1 charged horizon ring present
uniform float u_streakOn;   // 0/1 anamorphic streak present
uniform float u_lensDir;    // -1/+1 lens swirl chirality
uniform float u_starTier;   // 0/1/2 star/powder density tier
uniform float u_precut;     // 0..1 anticipation charge (final beat before a cut)
uniform float u_cutFlash;   // 0..1 drop-on-boundary slam (decays, rate-limited)

const vec3 LOW = ${aa(re[0])};
const vec3 HIGH = ${aa(re[2])};

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

float fbm(vec2 p) {
  float v = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 4; i++) {
    v += amp * noise(p);
    p = p * 2.03 + vec2(17.3, 9.1);
    amp *= 0.5;
  }
  return v;
}

// iq cosine palette. Unlike the parent, the four are SELECTED by an integer
// bank (u_palette snaps to a whole number per look) — no continuous morph,
// so a phrase cut is a hard palette change, not a slide.
vec3 pal0(float t) { return vec3(0.42, 0.14, 0.1) + vec3(0.42, 0.24, 0.14) * cos(6.28318 * (vec3(1.0, 0.9, 0.6) * t + vec3(0.0, 0.15, 0.25))); }
vec3 pal1(float t) { return vec3(0.45, 0.28, 0.42) + vec3(0.25, 0.35, 0.5) * cos(6.28318 * (vec3(1.0, 0.85, 0.7) * t + vec3(0.0, 0.2, 0.45))); }
vec3 pal2(float t) { return vec3(0.14, 0.36, 0.32) + vec3(0.3, 0.5, 0.45) * cos(6.28318 * (vec3(0.9, 1.0, 0.8) * t + vec3(0.1, 0.3, 0.5))); }
vec3 pal3(float t) { return vec3(0.5, 0.38, 0.24) + vec3(0.48, 0.42, 0.34) * cos(6.28318 * (vec3(1.0, 0.9, 0.8) * t + vec3(0.0, 0.12, 0.25))); }

// DISCRETE palette select: choose the bank nearest u_palette. No mix between
// banks — the cut is the aesthetic. Bright, saturated (repo dislikes pastels).
vec3 palette(float t) {
  float b = floor(u_palette + 0.5);
  vec3 c = pal0(t);
  c = b > 0.5 ? pal1(t) : c;
  c = b > 1.5 ? pal2(t) : c;
  c = b > 2.5 ? pal3(t) : c;
  // Drops warm, buildups cool (parent idiom); the cut-flash SATURATES.
  c += vec3(0.1, -0.02, -0.05) * u_drop - vec3(0.06, 0.02, -0.04) * u_buildup;
  c *= 1.0 + 0.25 * u_cutFlash;
  return c;
}

float starShape(vec2 f, float size) {
  float d2 = dot(f, f);
  float core = exp(-d2 * 1100.0 / size);
  float halo = exp(-d2 * 140.0 / size) * 0.2;
  float spikes = (exp(-abs(f.x) * 190.0 / size) * exp(-abs(f.y) * 16.0 / size)
    + exp(-abs(f.y) * 190.0 / size) * exp(-abs(f.x) * 16.0 / size)) * 0.55;
  return core + halo + spikes;
}

vec3 starScatter(vec2 c, float density, float sizeScale, float gate, float gain) {
  vec2 q = c * density;
  vec2 cell = floor(q);
  vec2 sc = cell + vec2(fract(u_seed * 0.7131) * 61.7, fract(u_seed * 0.3719) * 43.1);
  vec2 pos = vec2(hash(sc + 1.3), hash(sc.yx + 4.7)) * 0.7 + 0.15;
  vec2 f = fract(q) - pos;
  float on = step(gate - 0.09 * u_spawn, hash(sc * 1.618 + 9.7));
  float size = (0.5 + 1.5 * hash(sc.yx * 2.113)) * sizeScale;
  float bright = 0.4 + 0.6 * hash(sc + 17.9);
  // Star tint samples the OWN quantized-bank palette at each star's hash phase
  // (wide span, spectral-hue biased) instead of a fixed cool/warm ramp.
  // Luminance unchanged (starShape * on * bright * gain).
  vec3 tint = palette(hash(sc.yx + 29.3) * 1.6 + u_time * 0.02 + u_specHue * 0.5);
  return mix(tint, HIGH, 0.2) * starShape(f, size) * on * bright * gain;
}

uniform float u_hueRot; // fringe fix: per-song hue anchor + slow spectral travel, TURNS 0..1

// fringe fix: value-preserving hue ROTATION in YIQ chroma-plane (dust-v3
// idiom). rot is in TURNS; luminance (Y) is untouched by construction.
vec3 hueRotate(vec3 c, float rot) {
  float y = dot(c, vec3(0.299, 0.587, 0.114));
  float i = dot(c, vec3(0.596, -0.274, -0.322));
  float q = dot(c, vec3(0.211, -0.523, 0.312));
  float h = atan(q, i) + rot * 6.28318;
  float chroma = sqrt(i * i + q * q);
  i = chroma * cos(h);
  q = chroma * sin(h);
  return max(vec3(0.0), vec3(
    y + 0.956 * i + 0.621 * q,
    y - 0.272 * i - 0.647 * q,
    y - 1.106 * i - 1.703 * q
  ));
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  float aspect = u_res.x / u_res.y;
  vec2 c = (uv - 0.5) * vec2(aspect, 1.0);
  float r = length(c);
  float ang = atan(c.y, c.x);
  float t = u_time;
  vec2 px = 1.0 / u_res;

  // ---- Warp: differential rotation (direction from the look's rotDir, folded
  // into u_rotStep JS-side) + churn + traveling kick ripple.
  float rot = u_rotStep * (0.35 + 1.4 * exp(-r * 2.2));
  float cs = cos(rot);
  float sn = sin(rot);
  vec2 w = mat2(cs, -sn, sn, cs) * c / u_zoom;
  vec2 dirW = r > 1e-4 ? c / r : vec2(0.0);
  vec2 churn = (vec2(
    fbm(c * 2.6 + t * 0.12),
    fbm(c * 2.6 + vec2(7.7, 3.1) - t * 0.09)
  ) - 0.5) * (0.002 + 0.018 * u_mid + 0.012 * u_buildup);
  float waveFront = 0.16 + u_rippleAge * 0.9;
  float rippleWave = exp(-pow((r - waveFront) * 9.0, 2.0)) * exp(-u_rippleAge * 2.4) * u_rippleAmp;
  vec2 ripple = dirW * rippleWave * 0.035;
  // Localized black-hole lens; chirality is the look's lensDir (discrete).
  float horizon = (0.14 + 0.1 * u_low) * (1.0 + 0.07 * u_charge);
  float lens = (0.4 * u_low + 1.5 * u_kick) * (1.0 + 0.9 * u_charge) * exp(-pow(r / horizon, 2.0) * 1.4);
  float drag = lens * 0.12 * u_lensDir;
  float dcs = cos(drag);
  float dsn = sin(drag);
  w = mat2(dcs, -dsn, dsn, dcs) * w;
  vec2 lensPull = dirW * lens * 0.055;
  vec2 src = (w + churn + ripple + lensPull) / vec2(aspect, 1.0) + 0.5;

  // Chromatic aberration: radial RGB split (parent), widening on the cut-flash.
  vec2 ab = dirW * (0.0012 + 0.004 * u_drop + 0.003 * u_kick + 0.01 * rippleWave + 0.006 * u_cutFlash)
    / vec2(aspect, 1.0);
  ab *= u_dust; // fringe amount rides the dust param (human note)
  // fringe fix: hue-steerable fringes -- rotate the field to the anchor
  // frame, split channels there, rotate back. Clamped >= 0 (hueRotate can
  // go slightly negative) so the unsharp feedback loop stays stable.
  float fringeRot = u_hueRot;
  vec3 tapA = texture2D(u_prev, src + ab).rgb;
  vec3 tapC = texture2D(u_prev, src).rgb;
  vec3 tapB = texture2D(u_prev, src - ab).rgb;
  vec3 sampled = max(vec3(0.0), hueRotate(vec3(
    hueRotate(tapA, -fringeRot).r,
    hueRotate(tapC, -fringeRot).g,
    hueRotate(tapB, -fringeRot).b
  ), fringeRot));
  // Unsharp anti-mush tap (parent).
  vec3 blur = (texture2D(u_prev, src + vec2(px.x, 0.0)).rgb
    + texture2D(u_prev, src - vec2(px.x, 0.0)).rgb
    + texture2D(u_prev, src + vec2(0.0, px.y)).rgb
    + texture2D(u_prev, src - vec2(0.0, px.y)).rgb) * 0.25;
  vec3 sky = max(vec3(0.0), sampled * 1.35 - blur * 0.35) * u_decay;

  // ---- Steady layers, injected at (1 - decay).
  vec3 fresh = vec3(0.0);
  float volt = (noise(vec2(ang * 14.0 + t * 3.0, t * 22.0)) - 0.5)
    + 0.5 * (noise(vec2(ang * 30.0 - t * 5.0, t * 37.0)) - 0.5);
  float bassWarp = u_low * (0.2 * sin(ang * 3.0 + t * 1.7) + 0.13 * sin(ang * 5.0 - t * 2.3))
    + 0.16 * u_kick * sin(ang * 7.0 + t * 9.0)
    + volt * (0.14 * u_low + 0.32 * u_kick);
  float rc = r * (1.0 - bassWarp * exp(-r * 3.0));
  float heart = exp(-rc * rc * (260.0 - 130.0 * u_kick));
  float corona = exp(-rc * (7.0 - 3.0 * u_low));
  float gravity = sin(rc * 46.0 - t * (3.0 + 9.0 * u_low)) * 0.5 + 0.5;
  float gravityGain = u_low * (0.5 + 0.8 * u_kick);
  // Gravity ripple color: a warm slice of the OWN bank palette (spectral-hue
  // biased) instead of a fixed ember/LOW mix. Gain unchanged.
  vec3 gravityColor = palette(0.05 + t * 0.015 + u_specHue * 0.5);
  fresh += gravityColor
    * pow(gravity, 4.0) * exp(-r * 5.0) * gravityGain;
  // The event-horizon ring — GATED by the look's discrete ringOn.
  float arcJitter = volt * (0.012 + 0.05 * u_kick + 0.022 * u_low);
  float ringGlow = exp(-pow((r - horizon - arcJitter) * 52.0, 2.0));
  float ringCore = exp(-pow((r - horizon - arcJitter) * 210.0, 2.0));
  float bassOn = smoothstep(0.06, 0.3, u_low);
  // Ring color: a warm bank-palette slice (spectral-hue biased) charging toward
  // a warmer accent then white-hot at high charge. Palette supplies hue; the
  // charge->white ramp and gains preserve luminance.
  vec3 chargeColor = mix(palette(0.02 + u_specHue * 0.5), palette(0.12 + u_specHue * 0.5), clamp(u_charge, 0.0, 1.0));
  chargeColor = mix(chargeColor, vec3(1.0, 0.97, 0.92), clamp(u_charge - 0.6, 0.0, 0.4) * 2.5);
  fresh += chargeColor * ringGlow * (0.12 + 0.6 * u_low + 1.1 * u_kick + 0.5 * u_charge) * u_ringOn;
  fresh += mix(chargeColor, vec3(1.0), 0.5 * u_kick) * ringCore
    * (0.3 + 1.3 * bassOn + 2.4 * u_kick + 0.8 * u_charge) * u_ringOn;
  // Coal heart (always present — bass identity): a deep, low-luma slice of the
  // OWN bank palette (spectral-hue biased) instead of a fixed dark red. Kept
  // dark (0.55 floor); gains/kick-whiten preserve luminance.
  vec3 coal = palette(0.0 + u_specHue * 0.5) * 0.55;
  fresh += mix(coal, vec3(1.0, 0.8, 0.7), 0.5 * u_kick) * heart * (0.5 + 1.2 * u_low + 1.4 * u_kick);
  fresh += mix(coal, LOW, 0.4) * corona * (0.1 + 0.6 * u_low + 0.35 * u_kick);
  float centerDim = smoothstep(horizon * 0.45, horizon * 1.2, r);
  // Anamorphic lens streak — GATED by the look's discrete streakOn. Both ends
  // sample the OWN palette (a wide phase offset for the cool end, spectral-hue
  // biased) instead of a fixed steel-blue.
  float streak = exp(-abs(c.y) * 110.0) * exp(-abs(c.x) * (4.5 - 1.5 * u_drop));
  fresh += mix(palette(0.7 + u_specHue * 0.5), palette(t * 0.02), 0.65) * streak
    * (0.25 + 1.2 * u_low + 0.8 * u_kick) * u_streakOn;
  // The disk: spiral lanes — the ARM COUNT is the look's integer u_arms
  // (2/3/5/7). It never interpolates: a phrase cut snaps to a new polygon.
  float arm = sin(ang * u_arms + log(r + 0.06) * 5.0 - u_armPhase + 0.5 * u_mid * sin(ang * 3.0 + r * 6.0 + t * 0.7));
  float lanes = pow(0.5 + 0.5 * arm, 3.0) * smoothstep(0.06, 0.2, r) * exp(-r * 1.8);
  float cloudField = fbm(vec2(ang * 2.2 + r * 3.0 - t * 0.15, r * 5.0 + t * 0.06));
  float cloud = pow(cloudField, 2.4);
  // SPECTRAL DUST TINT: the disk palette phase is biased by the slow-tracked
  // centroid (u_specHue, ~1s EMA) so dust hue follows spectral content.
  vec3 diskColor = palette(cloudField * 1.5 + r * 0.35 + ang * 0.1 + t * 0.012 + u_centroid * 0.4 + u_specHue * 0.8);
  float reverb = 1.0 + 2.6 * rippleWave;
  float midGate = smoothstep(0.04, 0.3, u_mid);
  fresh += diskColor * lanes * (0.1 + 1.2 * u_mid) * (0.5 + cloud) * u_dust * centerDim * midGate * reverb;
  fresh += diskColor * cloud * exp(-r * 2.4) * u_mid * 0.45 * u_dust * centerDim * midGate * reverb;
  // High nebula.
  float wisp = fbm(vec2(ang * 6.0 - t * 0.5, r * 10.0 + t * 0.25));
  float shimmer = 0.6 + 0.4 * sin(t * 13.0 + wisp * 24.0);
  vec3 electric = mix(palette(0.85 + u_specHue * 0.5), palette(0.6 + t * 0.03 + u_specHue * 0.5), 0.65);
  fresh += electric * pow(wisp, 3.2) * shimmer * smoothstep(0.12, 0.5, r)
    * (0.08 + 1.7 * u_high) * u_dust * reverb;
  sky += fresh * (1.0 - u_decay) * (3.2 + 1.6 * u_sustain);

  // High-transient nebula puffs — scaled by the discrete star tier.
  if (u_spawn > 0.01) {
    vec2 sOff = vec2(fract(u_seed * 0.7131) * 21.7, fract(u_seed * 0.3719) * 13.1);
    float puff = pow(fbm(c * 7.0 + sOff), 3.5);
    sky += electric * puff * smoothstep(0.1, 0.4, r) * u_spawn * 0.9;
  }

  // ---- Transient stamps.
  if (u_kick > 0.02) {
    float ringR = 0.1 + 0.05 * u_kick;
    float shock = exp(-pow((r - ringR) * 38.0, 2.0))
      + 0.6 * exp(-pow((r - ringR * 1.7) * 30.0, 2.0));
    // Shockwave hue from the OWN bank palette (spectral-hue biased) mixed toward
    // a warm-white accent. Kick gain / drop scaling unchanged (luminance identical).
    sky += mix(palette(0.05 + u_specHue * 0.5), vec3(1.0, 0.9, 0.8), 0.5) * shock * u_kick * (1.15 + 0.8 * u_drop);
    sky *= 1.0 + 0.1 * u_kick;
  }
  if (u_snare > 0.03) {
    float arc = exp(-pow((r - 0.3) * 30.0, 2.0)) * pow(0.5 + 0.5 * sin(ang * (u_arms + 1.0) + u_seed), 2.0);
    sky += palette(0.3 + t * 0.02) * arc * u_snare * 0.7;
  }
  if (u_spawn > 0.003 || u_spawnSnare > 0.003) {
    float reach = smoothstep(0.05, 0.18, r);
    sky += starScatter(c + 11.3, 16.0, 2.8, 0.984, u_spawnSnare * 1.2) * reach
      * mix(vec3(1.0), palette(0.15), 0.45);
  }

  // ---- ANTICIPATION TICK: the final beat before a cut raises a faint charge
  // ring at the horizon (tension, no flash). Localized => photosafe.
  if (u_precut > 0.001) {
    float pre = exp(-pow((r - horizon * 1.6) * 14.0, 2.0));
    sky += mix(chargeColor, vec3(1.0), 0.4) * pre * u_precut * 0.35;
  }

  // Film grain.
  sky += (hash(gl_FragCoord.xy + fract(t) * 191.0) - 0.5) * (0.012 + 0.02 * u_drop);

  // Palette grade (whole frame leans toward the current bank's hue).
  vec3 grade = palette(0.35 + u_centroid * 0.2);
  sky = mix(sky, sky * (0.4 + grade * 1.5), 0.24);
  // Buildups cool/dim, drops bloom (parent). The CUT-FLASH adds a moderate,
  // rate-limited brightness slam (≤1 per 4 bars — photosafe, not a strobe).
  sky *= 0.72 + 0.45 * max(u_drop, u_sustain) - 0.05 * u_buildup + 0.35 * u_cutFlash;
  // Chroma-preserving soft knee (never per-channel clamp).
  float m = max(sky.r, max(sky.g, sky.b));
  if (m > 0.8) {
    sky *= (0.8 + 0.2 * (1.0 - exp(-(m - 0.8) * 3.0))) / m;
  }
  gl_FragColor = vec4(max(sky, 0.0), 1.0);
}
`,tr=[{id:"stars",label:"star density",min:0,max:2,step:.05,default:1},{id:"dust",label:"dust amount",min:0,max:2,step:.05,default:1},{id:"persistence",label:"persistence",min:.5,max:2,step:.05,default:1},{id:"speed",label:"flight speed",min:.2,max:2.5,step:.05,default:1},{id:"cutStrength",label:"cut drama",min:0,max:2,step:.05,default:1}];function ar(t){let e=(t>>>0)+2654435769;return()=>{e=e+2654435769>>>0;let o=e;return o=Math.imul(o^o>>>16,569420461)>>>0,o=Math.imul(o^o>>>15,1935289751)>>>0,o=(o^o>>>15)>>>0,o/4294967296}}const oa=[2,3,5,7];function or(t){return{paletteBank:Math.floor(t()*4),armCount:oa[Math.floor(t()*oa.length)],ringOn:t()>.28?1:0,streakOn:t()>.5?1:0,lensDir:t()>.5?1:-1,starTier:Math.floor(t()*3),rotDir:t()>.5?1:-1}}function Xe(t,e,o){const r=ar(((Math.round(t)|0)^Math.imul(e|0,2654435769))>>>0),a=or(r);return o!==0&&(a.paletteBank=(a.paletteBank+1+Math.abs(o)%3)%4),a}function rr(t){const e=t.decks.find(a=>a.channel===t.dominantChannel);if(e&&e.trackId!=null)return e.trackId;let o=null,r=-1;for(const a of t.decks)!a.playing||a.trackId==null||a.level>r&&(r=a.level,o=a.trackId);return o}const qe=4,sr=16,ir={id:"g07-voyage-hardcut",name:"g07 voyage-hardcut",hiRes:!0,params:tr,create:()=>{let t=0,e=0,o=null,r=0,a=999,s=0,i=0,b=0,p=0,x=0,v=.5,u=null,w=0,g=Xe(1,0,0),k=null,d=null,_=0,f=-999;return ue({fragment:er,feedback:!0,uniforms:n=>{var G,U,B,K,ae,J,te,V,le,j;const T=r>0?Math.min(.1,Math.max(0,n.time-r)):.016666666666666666;r=n.time;const C=X(n.bands),M=(G=n.bandsSlow)!=null?G:n.bands,c=(U=n.params.speed)!=null?U:1,l=(B=n.params.persistence)!=null?B:1,m=(K=n.params.cutStrength)!=null?K:1,P=Math.min(1,Math.max(0,(n.bands.low-.2)/.5)),h=1-Math.exp(-T/.35);b+=(n.trend.excitement*P-b)*h,p+=(n.trend.excitement*(1-P)-p)*h;const y=b,S=p,I=Math.min(1,C*1.4),A=rr(n),E=A!=null?A:Math.round((n.centroid*331+n.spread*271+n.flatness*197)*101);if(u==null||E!==u){u=E;const $=n.beat?(ae=n.beat.ladderBarIndex)!=null?ae:n.beat.barIndex:0;w=Math.floor($/qe),g=Xe(u,w,0)}const R=n.beat?(J=n.beat.ladderBarIndex)!=null?J:n.beat.barIndex:null,D=n.beat?n.beat.barPhase:0;let H=0;if(R!==null){const $=Math.floor(R/qe),oe=Math.floor(R/sr);if(k!==null&&$!==k){d!==null&&oe!==d?(w+=3+Math.abs(oe)%3,g=Xe(u,w,oe-(d!=null?d:0)||1)):(w+=1,g=Xe(u,w,0));const ie=Math.max(y,.6*I);ie>.25&&$-f>=1&&(_=Math.min(1,ie)*m,f=$)}k=$,d=oe,(R%qe+qe)%qe===qe-1&&(H=Math.max(0,(D-.75)/.25)*m)}else k=null,d=null;_=Math.max(0,_-T/.5),i+=T*((te=n.beat)!=null&&te.bpm?n.beat.bpm/60*Math.PI*2/64:.12),x=Math.min(1.4,x*Math.exp(-T/2.5)+n.impulse.low*.28),a+=T,n.impulse.low>.35&&a>.12&&(a=0,s=Math.min(1,n.impulse.low*1.2));const q=Math.max(y,.7*I),O=1+(.08+.7*q+3.6*n.impulse.low*(.5+.5*q))*c*T-.3*S*T,W=.992-.008*C-.008*S;v+=(n.centroid-v)*(1-Math.exp(-T/1));const F=.35+.55*g.starTier;let z=null,L=-1;for(const $ of n.decks)$.level>L&&(L=$.level,z=$.trackId);return z!==null&&z!==o&&(o=z,e=Zo(z)),t+=(e-t)*(1-Math.exp(-T/2)),{u_hueRot:((t+(v-.5)*.8)%1+1)%1,u_time:n.time,u_low:n.bands.low,u_mid:n.bands.mid,u_high:n.bands.high,u_kick:n.impulse.low,u_snare:n.impulse.mid,u_centroid:n.centroid,u_specHue:v,u_drop:y,u_buildup:S,u_zoom:O,u_rotStep:(.05+.5*M.mid+.5*S+.25*I)*c*T*g.rotDir,u_decay:Math.min(.998,1-(1-W)/l),u_seed:Math.floor(n.time*20),u_rippleAge:a,u_rippleAmp:s,u_sustain:I,u_armPhase:i,u_charge:x,u_dust:(V=n.params.dust)!=null?V:1,u_palette:g.paletteBank,u_spawn:Math.min(1,1.15*n.impulse.high+.2*n.bands.high)*((le=n.params.stars)!=null?le:1)*F*(.4+.6*Math.max(y,I))/(1+1.8*S)/(1+2.2*n.impulse.low),u_spawnSnare:Math.min(1,.95*n.impulse.mid)*((j=n.params.stars)!=null?j:1)*F*(.5+.5*Math.max(y,I))/(1+.8*S)/(1+2.2*n.impulse.low),u_arms:g.armCount,u_ringOn:g.ringOn,u_streakOn:g.streakOn,u_lensDir:g.lensDir,u_starTier:g.starTier,u_precut:Math.min(1,H),u_cutFlash:Math.min(1,_)}}})}},nr=t=>{let e=Math.floor(Math.abs(t))+2654435769>>>0;return e=Math.imul(e^e>>>16,569420461)>>>0,e=Math.imul(e^e>>>15,1935289751)>>>0,e=(e^e>>>15)>>>0,e/4294967296},ra=t=>`vec3(${t[0].toFixed(3)}, ${t[1].toFixed(3)}, ${t[2].toFixed(3)})`,lr=`
precision highp float;
uniform sampler2D u_prev;
uniform vec2 u_res;
uniform float u_time;
uniform float u_low;
uniform float u_lowSlow;    // motion-grade low: gravity-wave phase rate (erratic-motion law)
uniform float u_mid;
uniform float u_midSlow;    // motion-grade mid: churn/warp rate (erratic-motion law)
uniform float u_high;
uniform float u_kick;
uniform float u_snare;
uniform float u_centroid;
uniform float u_specHue;    // slow-tracked centroid (~1s EMA): dust hue follows spectral content
uniform float u_drop;
uniform float u_buildup;
uniform float u_zoom;
uniform float u_rotStep;
uniform float u_decay;
uniform float u_seed;
uniform float u_spawn;
uniform float u_rippleAge;
uniform float u_rippleAmp;
uniform float u_sustain;
uniform float u_armPhase;
uniform float u_dust;
uniform float u_charge;
uniform float u_spawnSnare;
uniform float u_hueRot;   // DUST FIX v3: per-song hue anchor + slow travel, TURNS 0..1

// ---- DECK MIX (replaces the parent's cosine palette engine) ----
uniform vec3 u_deckPrimary;   // dominant audible deck identity hue
uniform vec3 u_deckSecondary; // second audible deck (== primary when solo)
uniform vec3 u_deckAccent;    // brightest/most-saturated tint of the mix
uniform float u_deckBlend;    // 0 solo … 1 evenly split transition
uniform float u_deckPresence; // total audible energy 0..1 (silence dims)

const vec3 LOW = ${ra(re[0])};
const vec3 HIGH = ${ra(re[2])};

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

float fbm(vec2 p) {
  float v = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 4; i++) {
    v += amp * noise(p);
    p = p * 2.03 + vec2(17.3, 9.1);
    amp *= 0.5;
  }
  return v;
}

// DECK-MIX palette: t sweeps a wide phase span between the two audible deck
// hues (so shades/tints drift spatially and the dust never goes
// monochrome), the accent lifts the peaks, presence dims toward black when
// nothing is audible. A transition crossfades the whole cosmos from the
// outgoing deck to the incoming one, weighted by their level share.
vec3 palette(float t) {
  float s = 0.5 - 0.5 * cos(6.28318 * fract(t));
  // Spatial travel across the transition: at solo, drift stays inside the
  // primary hue; at a split, the whole field sweeps primary -> secondary.
  float split = mix(s, smoothstep(0.3, 0.7, s), u_deckBlend);
  vec3 base = mix(u_deckPrimary, u_deckSecondary, split);
  float peak = pow(s, 2.2);
  vec3 c = mix(base, u_deckAccent, 0.4 * peak);
  // Wide tint/shade span within the hue so dust reads as many shades.
  c *= 0.5 + 0.7 * (0.35 + 0.65 * s);
  c += (vec3(0.1, -0.02, -0.05) * u_drop - vec3(0.06, 0.02, -0.04) * u_buildup) * u_deckPresence;
  return c * (0.14 + 0.86 * u_deckPresence);
}

float starShape(vec2 f, float size) {
  float d2 = dot(f, f);
  float core = exp(-d2 * 1100.0 / size);
  float halo = exp(-d2 * 140.0 / size) * 0.2;
  float spikes = (exp(-abs(f.x) * 190.0 / size) * exp(-abs(f.y) * 16.0 / size)
    + exp(-abs(f.y) * 190.0 / size) * exp(-abs(f.x) * 16.0 / size)) * 0.55;
  return core + halo + spikes;
}

vec3 starScatter(vec2 c, float density, float sizeScale, float gate, float gain) {
  vec2 q = c * density;
  vec2 cell = floor(q);
  vec2 sc = cell + vec2(fract(u_seed * 0.7131) * 61.7, fract(u_seed * 0.3719) * 43.1);
  vec2 pos = vec2(hash(sc + 1.3), hash(sc.yx + 4.7)) * 0.7 + 0.15;
  vec2 f = fract(q) - pos;
  float on = step(gate - 0.09 * u_spawn, hash(sc * 1.618 + 9.7));
  float size = (0.5 + 1.5 * hash(sc.yx * 2.113)) * sizeScale;
  float bright = 0.4 + 0.6 * hash(sc + 17.9);
  // Star tint samples the OWN deck-mix palette at each star's hash phase (wide
  // span, spectral-hue biased) instead of a fixed cool/warm ramp. Luminance
  // unchanged (starShape * on * bright * gain).
  vec3 tint = palette(hash(sc.yx + 29.3) * 1.6 + u_time * 0.02 + u_specHue * 0.5);
  return mix(tint, HIGH, 0.2) * starShape(f, size) * on * bright * gain;
}

// DUST FIX v3: value-preserving hue ROTATION (YIQ chroma plane). rot in TURNS;
// luminance (Y) untouched so gains are unchanged. Negatives clamped.
vec3 hueRotate(vec3 c, float rot) {
  float y = dot(c, vec3(0.299, 0.587, 0.114));
  float i = dot(c, vec3(0.596, -0.274, -0.322));
  float q = dot(c, vec3(0.211, -0.523, 0.312));
  float h = atan(q, i) + rot * 6.28318;
  float chroma = sqrt(i * i + q * q);
  i = chroma * cos(h);
  q = chroma * sin(h);
  return max(vec3(0.0), vec3(
    y + 0.956 * i + 0.621 * q,
    y - 0.272 * i - 0.647 * q,
    y - 1.106 * i - 1.703 * q
  ));
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  float aspect = u_res.x / u_res.y;
  vec2 c = (uv - 0.5) * vec2(aspect, 1.0);
  float r = length(c);
  float ang = atan(c.y, c.x);
  float t = u_time;
  vec2 px = 1.0 / u_res;

  // ---- Warp: differential rotation + churn + traveling kick ripple (parent).
  float rot = u_rotStep * (0.35 + 1.4 * exp(-r * 2.2));
  float cs = cos(rot);
  float sn = sin(rot);
  vec2 w = mat2(cs, -sn, sn, cs) * c / u_zoom;
  vec2 dirW = r > 1e-4 ? c / r : vec2(0.0);
  vec2 churn = (vec2(
    fbm(c * 2.6 + t * 0.12),
    fbm(c * 2.6 + vec2(7.7, 3.1) - t * 0.09)
  ) - 0.5) * (0.002 + 0.018 * u_midSlow + 0.012 * u_buildup);  // motion: slow bands (erratic-motion law)
  float waveFront = 0.16 + u_rippleAge * 0.9;
  float rippleWave = exp(-pow((r - waveFront) * 9.0, 2.0)) * exp(-u_rippleAge * 2.4) * u_rippleAmp;
  vec2 ripple = dirW * rippleWave * 0.035;
  float horizon = (0.14 + 0.1 * u_low) * (1.0 + 0.07 * u_charge);
  float lens = (0.4 * u_low + 1.5 * u_kick) * (1.0 + 0.9 * u_charge) * exp(-pow(r / horizon, 2.0) * 1.4);
  float drag = lens * 0.12;
  float dcs = cos(drag);
  float dsn = sin(drag);
  w = mat2(dcs, -dsn, dsn, dcs) * w;
  vec2 lensPull = dirW * lens * 0.055;
  vec2 src = (w + churn + ripple + lensPull) / vec2(aspect, 1.0) + 0.5;

  vec2 ab = dirW * (0.0012 + 0.004 * u_drop + 0.003 * u_kick + 0.01 * rippleWave)
    / vec2(aspect, 1.0);
  ab *= u_dust; // fringe amount rides the dust param (human note)
  // fringe fix: hue-steerable fringes -- rotate the field to the anchor
  // frame, split channels there, rotate back. Clamped >= 0 (hueRotate can
  // go slightly negative) so the unsharp feedback loop stays stable.
  float fringeRot = u_hueRot;
  vec3 tapA = texture2D(u_prev, src + ab).rgb;
  vec3 tapC = texture2D(u_prev, src).rgb;
  vec3 tapB = texture2D(u_prev, src - ab).rgb;
  vec3 sampled = max(vec3(0.0), hueRotate(vec3(
    hueRotate(tapA, -fringeRot).r,
    hueRotate(tapC, -fringeRot).g,
    hueRotate(tapB, -fringeRot).b
  ), fringeRot));
  vec3 blur = (texture2D(u_prev, src + vec2(px.x, 0.0)).rgb
    + texture2D(u_prev, src - vec2(px.x, 0.0)).rgb
    + texture2D(u_prev, src + vec2(0.0, px.y)).rgb
    + texture2D(u_prev, src - vec2(0.0, px.y)).rgb) * 0.25;
  vec3 sky = max(vec3(0.0), sampled * 1.35 - blur * 0.35) * u_decay;

  // ---- Steady layers, injected at (1 - decay).
  vec3 fresh = vec3(0.0);
  float volt = (noise(vec2(ang * 14.0 + t * 3.0, t * 22.0)) - 0.5)
    + 0.5 * (noise(vec2(ang * 30.0 - t * 5.0, t * 37.0)) - 0.5);
  float bassWarp = u_low * (0.2 * sin(ang * 3.0 + t * 1.7) + 0.13 * sin(ang * 5.0 - t * 2.3))
    + 0.16 * u_kick * sin(ang * 7.0 + t * 9.0)
    + volt * (0.14 * u_low + 0.32 * u_kick);
  float rc = r * (1.0 - bassWarp * exp(-r * 3.0));
  float heart = exp(-rc * rc * (260.0 - 130.0 * u_kick));
  float corona = exp(-rc * (7.0 - 3.0 * u_low));
  // motion: slow bands (erratic-motion law) — gravity-wave travel rate
  float gravity = sin(rc * 46.0 - t * (3.0 + 9.0 * u_lowSlow)) * 0.5 + 0.5;
  float gravityGain = u_low * (0.5 + 0.8 * u_kick);
  // Gravity ripple color: a warm slice of the OWN deck-mix palette (spectral-
  // hue biased) instead of a fixed ember/LOW mix. Gain unchanged.
  vec3 gravityColor = palette(0.05 + t * 0.015 + u_specHue * 0.5);
  fresh += gravityColor
    * pow(gravity, 4.0) * exp(-r * 5.0) * gravityGain;
  float arcJitter = volt * (0.012 + 0.05 * u_kick + 0.022 * u_low);
  float ringGlow = exp(-pow((r - horizon - arcJitter) * 52.0, 2.0));
  float ringCore = exp(-pow((r - horizon - arcJitter) * 210.0, 2.0));
  float bassOn = smoothstep(0.06, 0.3, u_low);
  // Ring color: a warm deck-mix palette slice (spectral-hue biased) charging
  // toward a warmer accent then white-hot at high charge. Palette supplies hue;
  // the charge->white ramp and gains preserve luminance.
  vec3 chargeColor = mix(palette(0.02 + u_specHue * 0.5), palette(0.12 + u_specHue * 0.5), clamp(u_charge, 0.0, 1.0));
  chargeColor = mix(chargeColor, vec3(1.0, 0.97, 0.92), clamp(u_charge - 0.6, 0.0, 0.4) * 2.5);
  fresh += chargeColor * ringGlow * (0.12 + 0.6 * u_low + 1.1 * u_kick + 0.5 * u_charge);
  fresh += mix(chargeColor, vec3(1.0), 0.5 * u_kick) * ringCore
    * (0.3 + 1.3 * bassOn + 2.4 * u_kick + 0.8 * u_charge);
  // Coal heart: a deep, low-luma slice of the OWN palette (spectral-hue biased)
  // instead of a fixed dark red. Kept dark (0.55 floor) so it reads as coal;
  // gains/kick-whiten preserve luminance.
  vec3 coal = palette(0.0 + u_specHue * 0.5) * 0.55;
  fresh += mix(coal, vec3(1.0, 0.8, 0.7), 0.5 * u_kick) * heart * (0.5 + 1.2 * u_low + 1.4 * u_kick);
  fresh += mix(coal, LOW, 0.4) * corona * (0.1 + 0.6 * u_low + 0.35 * u_kick);
  float centerDim = smoothstep(horizon * 0.45, horizon * 1.2, r);
  float streak = exp(-abs(c.y) * 110.0) * exp(-abs(c.x) * (4.5 - 1.5 * u_drop));
  // Streak: both ends sample the OWN palette (a wide phase offset for the cool
  // end, spectral-hue biased) instead of a fixed steel-blue.
  fresh += mix(palette(0.7 + u_specHue * 0.5), palette(t * 0.02), 0.65) * streak * (0.25 + 1.2 * u_low + 0.8 * u_kick);
  // The disk: spiral lanes + clouds in the TRAVELING deck-mix palette.
  float arm = sin(ang * 2.0 + log(r + 0.06) * 5.0 - u_armPhase + 0.5 * u_mid * sin(ang * 3.0 + r * 6.0 + t * 0.7));
  float lanes = pow(0.5 + 0.5 * arm, 3.0) * smoothstep(0.06, 0.2, r) * exp(-r * 1.8);
  float cloudField = fbm(vec2(ang * 2.2 + r * 3.0 - t * 0.15, r * 5.0 + t * 0.06));
  float cloud = pow(cloudField, 2.4);
  // SPECTRAL DUST TINT: the disk palette phase is biased by the slow-tracked
  // centroid (u_specHue, ~1s EMA) so dust hue follows spectral content.
  vec3 diskColor = hueRotate(palette(cloudField * 1.5 + r * 0.35 + ang * 0.1 + t * 0.012 + u_centroid * 0.4 + u_specHue * 0.8), u_hueRot);
  float reverb = 1.0 + 2.6 * rippleWave;
  float midGate = smoothstep(0.04, 0.3, u_mid);
  fresh += diskColor * lanes * (0.1 + 1.2 * u_mid) * (0.5 + cloud) * u_dust * centerDim * midGate * reverb;
  fresh += diskColor * cloud * exp(-r * 2.4) * u_mid * 0.45 * u_dust * centerDim * midGate * reverb;
  float wisp = fbm(vec2(ang * 6.0 - t * 0.5, r * 10.0 + t * 0.25));
  float shimmer = 0.6 + 0.4 * sin(t * 13.0 + wisp * 24.0);
  vec3 electric = mix(u_deckAccent, palette(0.6 + t * 0.03), 0.6);
  fresh += electric * pow(wisp, 3.2) * shimmer * smoothstep(0.12, 0.5, r)
    * (0.08 + 1.7 * u_high) * u_dust * reverb;
  sky += fresh * (1.0 - u_decay) * (3.2 + 1.6 * u_sustain);

  if (u_spawn > 0.01) {
    vec2 sOff = vec2(fract(u_seed * 0.7131) * 21.7, fract(u_seed * 0.3719) * 13.1);
    float puff = pow(fbm(c * 7.0 + sOff), 3.5);
    sky += electric * puff * smoothstep(0.1, 0.4, r) * u_spawn * 0.9;
  }

  if (u_kick > 0.02) {
    float ringR = 0.1 + 0.05 * u_kick;
    float shock = exp(-pow((r - ringR) * 38.0, 2.0))
      + 0.6 * exp(-pow((r - ringR * 1.7) * 30.0, 2.0));
    // Shockwave hue from the OWN palette (spectral-hue biased) mixed toward a
    // warm-white accent. Kick gain / drop scaling unchanged (luminance identical).
    sky += mix(palette(0.05 + u_specHue * 0.5), vec3(1.0, 0.9, 0.8), 0.5) * shock * u_kick * (1.15 + 0.8 * u_drop);
    sky *= 1.0 + 0.1 * u_kick;
  }
  if (u_snare > 0.03) {
    float arc = exp(-pow((r - 0.3) * 30.0, 2.0)) * pow(0.5 + 0.5 * sin(ang * 3.0 + u_seed), 2.0);
    sky += palette(0.3 + t * 0.02) * arc * u_snare * 0.7;
  }
  if (u_spawn > 0.003 || u_spawnSnare > 0.003) {
    float reach = smoothstep(0.05, 0.18, r);
    sky += starScatter(c + 11.3, 16.0, 2.8, 0.984, u_spawnSnare * 1.2) * reach
      * mix(vec3(1.0), palette(0.15), 0.45);
  }

  sky += (hash(gl_FragCoord.xy + fract(t) * 191.0) - 0.5) * (0.012 + 0.02 * u_drop);

  vec3 grade = palette(0.35 + u_centroid * 0.2);
  sky = mix(sky, sky * (0.4 + grade * 1.5), 0.24);
  sky *= 0.72 + 0.45 * max(u_drop, u_sustain) - 0.05 * u_buildup;
  float m = max(sky.r, max(sky.g, sky.b));
  if (m > 0.8) {
    sky *= (0.8 + 0.2 * (1.0 - exp(-(m - 0.8) * 3.0))) / m;
  }
  gl_FragColor = vec4(max(sky, 0.0), 1.0);
}
`;function cr(t){const e=parseInt(t.slice(1),16);return[(e>>16&255)/255,(e>>8&255)/255,(e&255)/255]}const sa=Object.fromEntries(Object.entries(mt).map(([t,e])=>[t,cr(e)]));function ia(t,e,o){return[t[0]+(e[0]-t[0])*o,t[1]+(e[1]-t[1])*o,t[2]+(e[2]-t[2])*o]}function na(t){const e=Math.max(t[0],t[1],t[2],1e-4),o=[t[0]/e,t[1]/e,t[2]/e];return ia(o,[1,1,1],.3)}const Ge=[.06,.06,.09];function ur(t){const e=(t.low+t.mid+t.high)/3;return .25+.75*Math.min(1,Math.max(0,e/.5))}function hr(t){var x,v;if(t.length===0)return{primary:Ge,secondary:Ge,accent:[.2,.2,.25],blend:0,presence:0};const e=[...t].sort((u,w)=>w.smooth-u.smooth),o=e[0],r=e.length>=2?e[1]:null,a=(x=sa[o.channel])!=null?x:Ge,s=r&&(v=sa[r.channel])!=null?v:a,i=r?Math.min(1,r.smooth/Math.max(1e-4,o.smooth)*1.2):0,b=ia(na(a),na(s),.5*i),p=Math.min(1,t.reduce((u,w)=>u+w.smooth,0)*1.15);return{primary:a,secondary:s,accent:b,blend:i,presence:p}}const pr={id:"g05-voyage-deckmix",name:"g05 voyage-deckmix",hiRes:!0,params:[{id:"stars",label:"star density",min:0,max:2,step:.05,default:1},{id:"dust",label:"dust amount",min:0,max:2,step:.05,default:1},{id:"persistence",label:"persistence",min:.5,max:2,step:.05,default:1},{id:"speed",label:"flight speed",min:.2,max:2.5,step:.05,default:1}],create:()=>{let t=0,e=999,o=0,r=0,a=0,s=0,i=0,b=.5,p=0,x=0,v=null;const u=new Map,w=[...Ge],g=[...Ge],k=[.2,.2,.25];let d=0,_=0;const f=(n,T,C)=>{n[0]+=(T[0]-n[0])*C,n[1]+=(T[1]-n[1])*C,n[2]+=(T[2]-n[2])*C};return ue({fragment:lr,feedback:!0,uniforms:n=>{var N,G,U,B,K,ae,J,te;const T=t>0?Math.min(.1,Math.max(0,n.time-t)):.016666666666666666;t=n.time;const C=X(n.bands),M=(N=n.bandsSlow)!=null?N:n.bands,c=X(M),l=(G=n.params.speed)!=null?G:1,m=(U=n.params.persistence)!=null?U:1,P=[];for(const V of n.decks){const le=V.level*ur(V.eq)*(.35+.65*V.fader),j=(B=u.get(V.channel))!=null?B:0,$=le>j?.05:.35,oe=1-Math.exp(-T/$),he=j+(le-j)*oe;u.set(V.channel,he),he>.02&&P.push({...V,smooth:he})}const h=hr(P),y=1-Math.exp(-T/.6),S=1-Math.exp(-T/.4);f(w,h.primary,y),f(g,h.secondary,y),f(k,h.accent,y),d+=(h.blend-d)*S,_+=(h.presence-_)*S;const I=Math.min(1,Math.max(0,(n.bands.low-.2)/.5)),A=1-Math.exp(-T/.35);a+=(n.trend.excitement*I-a)*A,s+=(n.trend.excitement*(1-I)-s)*A;const E=a,R=s,D=Math.min(1,C*1.4),H=Math.min(1,c*1.4),q=Math.max(E,.7*H),O=1+(.08+.7*q+3.6*n.impulse.low*(.5+.5*q))*l*T-.3*R*T;r+=T*((K=n.beat)!=null&&K.bpm?n.beat.bpm/60*Math.PI*2/64:.12),i=Math.min(1.4,i*Math.exp(-T/2.5)+n.impulse.low*.28),e+=T,n.impulse.low>.35&&e>.12&&(e=0,o=Math.min(1,n.impulse.low*1.2));const W=.992-.008*C-.008*R;b+=(n.centroid-b)*(1-Math.exp(-T/1));let F=null,z=-1;for(const V of n.decks)V.level>z&&(z=V.level,F=V.trackId);F!==null&&F!==v&&(v=F,x=nr(F)),p+=(x-p)*(1-Math.exp(-T/2));const L=((p+(b-.5)*.8)%1+1)%1;return{u_time:n.time,u_low:n.bands.low,u_lowSlow:M.low,u_mid:n.bands.mid,u_midSlow:M.mid,u_high:n.bands.high,u_kick:n.impulse.low,u_snare:n.impulse.mid,u_centroid:n.centroid,u_specHue:b,u_hueRot:L,u_drop:E,u_buildup:R,u_zoom:O,u_rotStep:(.05+.5*M.mid+.5*R+.25*H)*l*T,u_decay:Math.min(.998,1-(1-W)/m),u_seed:Math.floor(n.time*20),u_rippleAge:e,u_rippleAmp:o,u_sustain:D,u_armPhase:r,u_charge:i,u_dust:(ae=n.params.dust)!=null?ae:1,u_spawn:Math.min(1,1.15*n.impulse.high+.2*n.bands.high)*((J=n.params.stars)!=null?J:1)*(.4+.6*Math.max(E,D))/(1+1.8*R)/(1+2.2*n.impulse.low),u_spawnSnare:Math.min(1,.95*n.impulse.mid)*((te=n.params.stars)!=null?te:1)*(.5+.5*Math.max(E,D))/(1+.8*R)/(1+2.2*n.impulse.low),u_deckPrimary:[w[0],w[1],w[2]],u_deckSecondary:[g[0],g[1],g[2]],u_deckAccent:[k[0],k[1],k[2]],u_deckBlend:d,u_deckPresence:_}}})}},la=.92,dr=.65,fr=.42,ca=1.8,Je=16,mr=200,Qe=(t,e,o)=>t+(e-t)*o,gr=t=>Math.min(1,Math.max(0,t)),ua=t=>t*t*(3-2*t);class _r{constructor(){Y(this,"buffer",null);Y(this,"bufferCtx",null);Y(this,"rotation",0);Y(this,"chapter",0);Y(this,"drive",0)}ensureBuffer(e,o){return(!this.buffer||this.buffer.width!==e||this.buffer.height!==o)&&(this.buffer=document.createElement("canvas"),this.buffer.width=e,this.buffer.height=o,this.bufferCtx=this.buffer.getContext("2d")),this.bufferCtx}chapterTarget(e){const{trend:o,bands:r}=e,a=X(r),s=Math.max(o.excitement,a);let i;if(e.beat){const v=((e.beat.barIndex%Je+Je)%Je+e.beat.barPhase)/Je;i=v<.5?v*.4:.2+ua((v-.5)*2)*.8}else{const x=e.time%24/24;i=ua(x<.5?x*2:(1-x)*2)}const b=i*(1+1.1*o.excitement),p=Math.max(b,s*s);return gr(p)}render(e,o,r,a){var R,D,H;const s=this.ensureBuffer(o,r),{low:i,mid:b,high:p}=a.bands,x=(R=a.bandsSlow)!=null?R:a.bands,v=o/2,u=r/2,w=Math.min(o,r),g=this.chapterTarget(a),k=1-Math.exp(-a.dt/.5);this.chapter+=(g-this.chapter)*k;const d=this.chapter,_=Math.max(a.trend.excitement,X(a.bands));this.drive+=(_-this.drive)*(1-Math.exp(-a.dt/.35));const f=(D=a.params.dreamTrail)!=null?D:la,n=(H=a.params.punchZoom)!=null?H:ca,T=Qe(f,fr,d),C=Qe(dr,n,d),M=d;if(e.globalCompositeOperation="source-over",e.fillStyle="#000",e.fillRect(0,0,o,r),this.buffer&&s){const q=a.impulse.low,O=1+(.28+1.4*x.low*x.low+(2.6+2.4*M)*q)*C*a.dt;this.rotation=(.08+(.9+.9*M)*x.mid+(1.4+1.4*M)*a.impulse.mid)*a.dt,e.save(),e.translate(v,u),e.rotate(this.rotation),e.scale(O,O),e.globalAlpha=.88+.11*T,e.drawImage(this.buffer,-v,-u),e.restore(),e.globalAlpha=1}e.globalCompositeOperation="lighter";const c=X(a.bands),l=Qe(60,-30,d),m=Pe(c,a.time*6+l),P=w*(.1+.16*i),h=w*(.008+.03*(1-M))*b;e.beginPath();const y=64;for(let q=0;q<=y;q++){const O=q/y*Math.PI*2,W=6+4*M,F=P+Math.sin(O*W+a.time*(3+2*M))*h,z=v+Math.cos(O)*F,L=u+Math.sin(O)*F;q===0?e.moveTo(z,L):e.lineTo(z,L)}e.closePath();const S=42+30*i+15*M*a.impulse.low;if(e.strokeStyle=`hsl(${m}, 100%, ${Math.min(85,S)}%)`,e.lineWidth=Math.max(2,w*(.003+Qe(.016,.008,M)+.01*i)),e.stroke(),M>.55){const q=P*.6;e.beginPath(),e.arc(v,u,q,0,Math.PI*2),e.strokeStyle=`hsl(${(m+30)%360}, 100%, ${Math.min(80,55+20*a.impulse.low)}%)`,e.lineWidth=Math.max(1.5,w*.004*M),e.stroke()}const I=1+.8*M+.6*this.drive,A=mr*I*p*p*a.dt;let E=Math.floor(A)+(Math.random()<A%1?1:0);for(;E-- >0;){const q=Math.random()*Math.PI*2,O=P*(.9+Math.random()*.4),W=w*(.0015+.0035*Math.random());e.fillStyle=`hsl(${(m+180+Math.random()*40)%360}, 100%, 75%)`,e.beginPath(),e.arc(v+Math.cos(q)*O,u+Math.sin(q)*O,W,0,Math.PI*2),e.fill()}e.globalCompositeOperation="source-over",s&&this.buffer&&(s.clearRect(0,0,o,r),s.drawImage(e.canvas,0,0))}}const vr={id:"g04-tunnel-saga",name:"g04 tunnel-saga",params:[{id:"dreamTrail",label:"dream trail",min:0,max:1,step:.02,default:la},{id:"punchZoom",label:"punch zoom",min:.3,max:2.5,step:.05,default:ca}],create:()=>new _r},br=t=>{let e=Math.floor(Math.abs(t))+2654435769>>>0;return e=Math.imul(e^e>>>16,569420461)>>>0,e=Math.imul(e^e>>>15,1935289751)>>>0,e=(e^e>>>15)>>>0,e/4294967296},xr=`
precision highp float;
uniform sampler2D u_prev;
uniform vec2 u_res;
uniform float u_time;
uniform float u_low;
uniform float u_mid;
uniform float u_high;
uniform float u_kick;
uniform float u_snare;
uniform float u_zoom;
uniform float u_rot;
uniform float u_decay;
uniform float u_seed;
uniform float u_spark;
uniform float u_flow;
uniform float u_beatPump;

// ---- DECK MIX (replaces the tunnel's abstract hue ramp) ----
uniform vec3 u_deckPrimary;
uniform vec3 u_deckSecondary;
uniform vec3 u_deckAccent;
uniform float u_deckBlend;      // 0 solo … 1 evenly split transition
uniform float u_deckPresence;   // total audible energy 0..1
uniform float u_deckArrival;    // 0 far end … 1 arrived at the viewer
uniform float u_doubles;        // 0..1 doubles lock (interleaved-ring tell)
uniform vec3 u_bandGain;        // per-color-band survival after EQ kills

const float PI = 3.141592653589793;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

// Deck-mix palette. depth: 0 at the far tunnel end … 1 at the viewer.
// The incoming (secondary) deck rides in from depth 0; arrival pushes its
// color out toward the walls (depth 1). span keeps a WIDE in-hue phase
// sweep so a wall never collapses to one flat tone. bandGain applies EQ
// kills per color band (r/g/b weighted to the dominant deck hue).
vec3 deckPalette(float depth, float span) {
  float s = 0.5 - 0.5 * cos(6.28318 * fract(span));
  // Where along the tunnel the incoming deck has advanced to.
  float front = mix(0.06, 1.04, u_deckArrival);
  float incoming = smoothstep(front + 0.28, front - 0.28, depth);
  float split = mix(s, incoming, clamp(u_deckBlend, 0.0, 1.0));
  vec3 base = mix(u_deckPrimary, u_deckSecondary, split);
  float peak = pow(s, 2.0);
  vec3 c = mix(base, u_deckAccent, 0.30 * peak);
  c *= u_bandGain;                       // EQ kill mutes that color band
  c *= 0.45 + 0.6 * (0.35 + 0.65 * s);   // wide brightness sweep, no flat wall
  return c * (0.14 + 0.86 * u_deckPresence);
}

uniform float u_hueRot; // fringe fix: per-song hue anchor + slow spectral travel, TURNS 0..1

// fringe fix: value-preserving hue ROTATION in YIQ chroma-plane (dust-v3
// idiom). rot is in TURNS; luminance (Y) is untouched by construction.
vec3 hueRotate(vec3 c, float rot) {
  float y = dot(c, vec3(0.299, 0.587, 0.114));
  float i = dot(c, vec3(0.596, -0.274, -0.322));
  float q = dot(c, vec3(0.211, -0.523, 0.312));
  float h = atan(q, i) + rot * 6.28318;
  float chroma = sqrt(i * i + q * q);
  i = chroma * cos(h);
  q = chroma * sin(h);
  return max(vec3(0.0), vec3(
    y + 0.956 * i + 0.621 * q,
    y - 0.272 * i - 0.647 * q,
    y - 1.106 * i - 1.703 * q
  ));
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  float aspect = u_res.x / u_res.y;
  vec2 c = (uv - 0.5) * vec2(aspect, 1.0);
  float r = length(c);
  float ang = atan(c.y, c.x);
  float t = u_time;
  vec2 px = 1.0 / u_res;

  // ---- Warp the previous frame: zoom toward the viewer (kick lunge) with
  // a mid-driven twist. Milkdrop feedback advection — the tunnel walls are
  // successive rings smeared inward. (Parent motion, kept.)
  vec2 dirW = r > 1e-4 ? c / r : vec2(0.0);
  float cs = cos(u_rot);
  float sn = sin(u_rot);
  vec2 w = mat2(cs, -sn, sn, cs) * c / u_zoom;
  float churn = (noise(vec2(ang * 4.0 + t * 0.3, r * 6.0 - t * 0.2)) - 0.5)
    * (0.004 + 0.02 * u_mid);
  vec2 src = (w + dirW * churn) / vec2(aspect, 1.0) + 0.5;

  // Chromatic advection — a gentle dreamy split, stronger on a kick.
  vec2 ab = dirW * (0.0012 + 0.006 * u_kick + 0.003 * u_flow) / vec2(aspect, 1.0);
  ab *= u_flow; // fringe amount rides the dust param (human note)
  // fringe fix: hue-steerable fringes -- rotate the field to the anchor
  // frame, split channels there, rotate back. Clamped >= 0 (hueRotate can
  // go slightly negative) so the unsharp feedback loop stays stable.
  float fringeRot = u_hueRot;
  vec3 tapA = texture2D(u_prev, src + ab).rgb;
  vec3 tapC = texture2D(u_prev, src).rgb;
  vec3 tapB = texture2D(u_prev, src - ab).rgb;
  vec3 sampled = max(vec3(0.0), hueRotate(vec3(
    hueRotate(tapA, -fringeRot).r,
    hueRotate(tapC, -fringeRot).g,
    hueRotate(tapB, -fringeRot).b
  ), fringeRot));
  vec3 blur = (texture2D(u_prev, src + vec2(px.x, 0.0)).rgb
    + texture2D(u_prev, src - vec2(px.x, 0.0)).rgb
    + texture2D(u_prev, src + vec2(0.0, px.y)).rgb
    + texture2D(u_prev, src - vec2(0.0, px.y)).rgb) * 0.25;
  vec3 walls = max(vec3(0.0), sampled * 1.25 - blur * 0.25) * u_decay;

  // ---- Fresh geometry: the wobbling ring at the tunnel mouth, painted in
  // the deck mix. depth = radius (far end at center → viewer at the rim).
  float depth = clamp(r * 1.35, 0.0, 1.0);
  float wobble = 0.02 * u_mid;
  float ringR = 0.1 + 0.16 * u_low + sin(ang * 6.0 + t * 3.0) * wobble;
  float ringBand = exp(-pow((r - ringR) * 20.0, 2.0));

  // Wide in-hue phase span across the wall: angle + depth + flow travel.
  float span = ang / (2.0 * PI) + depth * 0.9 + u_deckArrival * 0.5 + t * 0.02 * u_flow;
  vec3 ringColor = deckPalette(depth, span);
  vec3 fresh = ringColor * ringBand * (0.6 + 1.4 * u_low + 1.1 * u_kick);

  // Continuous wall glow so the deck mix flows the whole tunnel, not just
  // the mouth ring — the incoming color streams from far end to rim.
  float wallGlow = smoothstep(0.02, 0.5, r) * exp(-r * 1.4);
  fresh += deckPalette(depth, span + 0.15) * wallGlow
    * (0.18 + 0.9 * u_deckPresence) * (0.6 + 0.7 * u_mid);

  // ---- DOUBLES: interleaved concentric rings snapping both deck hues.
  if (u_doubles > 0.5) {
    float rings = 9.0;
    float phase = fract(r * rings - t * 0.4 * (0.5 + 0.5 * u_flow));
    float interleave = step(0.5, phase);
    vec3 twinA = deckPalette(depth, 0.15);
    vec3 twinB = deckPalette(depth, 0.65);
    vec3 twin = mix(twinA, twinB, interleave);
    float ringTell = pow(0.5 + 0.5 * cos(6.28318 * r * rings - t * 2.0), 4.0);
    fresh += twin * ringTell * u_doubles * (0.4 + 0.9 * u_low + 0.8 * u_kick)
      * smoothstep(0.03, 0.2, r);
  }

  // ---- High-driven sparkles — feedback stretches them into star-streaks.
  if (u_spark > 0.001) {
    vec2 q = c * 26.0;
    vec2 cell = floor(q);
    vec2 sc = cell + vec2(fract(u_seed * 0.7131) * 61.7, fract(u_seed * 0.3719) * 43.1);
    vec2 pos = vec2(hash(sc + 1.3), hash(sc.yx + 4.7)) * 0.7 + 0.15;
    vec2 f = fract(q) - pos;
    float on = step(0.86, hash(sc * 1.618 + 9.7));
    float star = exp(-dot(f, f) * 240.0) * on;
    vec3 spk = mix(u_deckAccent, vec3(1.0), 0.4);
    fresh += spk * star * u_spark * smoothstep(0.08, 0.3, r);
  }

  vec3 col = walls + fresh * (1.0 - u_decay) * 3.4;
  col *= 1.0 + 0.06 * u_beatPump;

  // ---- Chroma-preserving soft knee (never per-channel clamp): compress
  // the LUMA above the knee, keep the hue.
  float m = max(col.r, max(col.g, col.b));
  if (m > 0.85) {
    col *= (0.85 + 0.15 * (1.0 - exp(-(m - 0.85) * 3.0))) / m;
  }
  gl_FragColor = vec4(max(col, 0.0), 1.0);
}
`;function wr(t){const e=parseInt(t.slice(1),16);return[(e>>16&255)/255,(e>>8&255)/255,(e&255)/255]}const ha=Object.fromEntries(Object.entries(mt).map(([t,e])=>[t,wr(e)])),$e=[.06,.06,.09];function pa(t,e,o){return[t[0]+(e[0]-t[0])*o,t[1]+(e[1]-t[1])*o,t[2]+(e[2]-t[2])*o]}function da(t){const e=Math.max(t[0],t[1],t[2],1e-4),o=[t[0]/e,t[1]/e,t[2]/e];return pa(o,[1,1,1],.35)}function yt(t){return Math.min(1,Math.max(0,t/.5))}function kr(t){var _,f;if(t.length===0)return{primary:$e,secondary:$e,accent:[.2,.2,.25],blend:0,presence:0,arrival:.5,doubles:0,bandGain:[1,1,1]};const e=[...t].sort((n,T)=>T.smooth-n.smooth),o=e[0],r=e.length>=2?e[1]:null,a=(_=ha[o.channel])!=null?_:$e,s=r&&(f=ha[r.channel])!=null?f:a,i=r?Math.min(1,r.smooth/Math.max(1e-4,o.smooth)*1.2):0,b=pa(da(a),da(s),.5*i),p=Math.min(1,t.reduce((n,T)=>n+T.smooth,0)*1.15),x=r&&o.trackId!==null&&o.trackId===r.trackId?Math.min(1,i*1.4):0,v=r!=null?r:o,u=Math.min(1,v.smooth*v.fader*1.6),w=yt(o.eq.low),g=yt(o.eq.mid),d=[.2+.8*yt(o.eq.high),.2+.8*g,.2+.8*w];return{primary:a,secondary:s,accent:b,blend:i,presence:p,arrival:u,doubles:x,bandGain:d}}const Ze={trail:.92,zoom:.65},yr={id:"g05-tunnel-deckmix",name:"g05 tunnel-deckmix",hiRes:!0,params:[{id:"trail",label:"trail length",min:0,max:1,step:.02,default:Ze.trail},{id:"zoom",label:"zoom drive",min:.3,max:2.5,step:.05,default:Ze.zoom},{id:"flow",label:"deck flow",min:0,max:2,step:.05,default:1}],create:()=>{let t=.5,e=0,o=0,r=null,a=0,s=0;const i=new Map,b=[...$e],p=[...$e],x=[.2,.2,.25],v=[1,1,1];let u=0,w=0,g=.5,k=0;const d=(_,f,n)=>{_[0]+=(f[0]-_[0])*n,_[1]+=(f[1]-_[1])*n,_[2]+=(f[2]-_[2])*n};return ue({fragment:xr,feedback:!0,uniforms:_=>{var E,R,D,H;const f=a>0?Math.min(.1,Math.max(0,_.time-a)):.016666666666666666;a=_.time;const n=X(_.bands),T=_.beat,C=(E=_.params.flow)!=null?E:1,M=(R=_.params.zoom)!=null?R:Ze.zoom,c=(D=_.params.trail)!=null?D:Ze.trail,l=[];for(const q of _.decks){const O=(H=i.get(q.channel))!=null?H:0,W=q.level>O?.05:.35,F=1-Math.exp(-f/W),z=O+(q.level-O)*F;i.set(q.channel,z),z>.02&&l.push({...q,smooth:z})}const m=kr(l),P=1-Math.exp(-f/.6),h=1-Math.exp(-f/.4);d(b,m.primary,P),d(p,m.secondary,P),d(x,m.accent,P),d(v,m.bandGain,h),u+=(m.blend-u)*h,w+=(m.presence-w)*h,g+=(m.arrival-g)*(1-Math.exp(-f/1.1)),k+=(m.doubles-k)*h;const y=1+(.28+1.2*_.bands.low*_.bands.low+3.5*_.impulse.low)*M*f;s=(.1+1.2*_.bands.mid+1.8*_.impulse.mid)*f,t+=(_.centroid-t)*(1-Math.exp(-f/1));let S=null,I=-1;for(const q of _.decks)q.level>I&&(I=q.level,S=q.trackId);return S!==null&&S!==r&&(r=S,o=br(S)),e+=(o-e)*(1-Math.exp(-f/2)),{u_hueRot:((e+(t-.5)*.8)%1+1)%1,u_time:_.time,u_low:_.bands.low,u_mid:_.bands.mid,u_high:_.bands.high,u_kick:_.impulse.low,u_snare:_.impulse.mid,u_zoom:y,u_rot:s,u_decay:Math.min(.985,.9+.085*c-.01*n),u_seed:Math.floor(_.time*20),u_spark:Math.min(1,1.1*_.impulse.high+.2*_.bands.high),u_flow:C,u_beatPump:T?Math.pow(1-T.phase,2):0,u_deckPrimary:[b[0],b[1],b[2]],u_deckSecondary:[p[0],p[1],p[2]],u_deckAccent:[x[0],x[1],x[2]],u_deckBlend:u,u_deckPresence:w,u_deckArrival:g,u_doubles:k,u_bandGain:[v[0],v[1],v[2]]}}})}},et={lowFloor:30,lowMid:250,midHigh:2500,highCeil:16e3},Mr=[et.lowFloor,et.lowMid,et.midHigh,et.highCeil],Rr=4.5,Sr=500,fa=-48,Ar=-12,Cr=.6,Tr=.008,Ir=.16,tt={low:0,mid:0,high:0};function Pr(t,e,o){const r=Math.log2(e/t)/o,a=[];for(let s=0;s<=o;s++)a.push(t*Math.pow(2,s*r));return a}function ma(t,e,o,r){const a=e/o,s=[];for(let i=0;i<r.length-1;i++)s.push(Er(t,a,r[i],r[i+1]));return s}function Dr(t,e,o){const[r,a,s]=ma(t,e,o,Mr);return{low:r,mid:a,high:s}}function Er(t,e,o,r){let a=Math.max(1,Math.ceil(o/e)),s=Math.min(t.length-1,Math.floor(r/e));if(s<a&&([a,s]=[s,a]),a<1||a>=t.length)return 0;let i=0;for(let v=a;v<=s;v++){const u=t[v];if(!Number.isFinite(u))continue;const w=u+Rr*Math.log2(v*e/Sr);i+=Math.pow(10,w/10)}const b=i/(s-a+1);if(b<=0)return 0;const p=10*Math.log10(b),x=Qr((p-fa)/(Ar-fa));return Math.pow(x,Cr)}function Fr(t,e,o){return e.map((r,a)=>{var s;return at((s=t[a])!=null?s:0,r,o)})}function Hr(t,e,o){return{low:at(t.low,e.low,o),mid:at(t.mid,e.mid,o),high:at(t.high,e.high,o)}}function at(t,e,o){const r=e>t?Tr:Ir;if(r<=0)return e;const a=1-Math.exp(-Math.max(0,o)/r);return t+(e-t)*a}const qr=.35,zr=.7;function Wr(t,e,o){return{low:Mt(t.low,e.low,o),mid:Mt(t.mid,e.mid,o),high:Mt(t.high,e.high,o)}}function Mt(t,e,o){const r=e>t?qr:zr,a=1-Math.exp(-Math.max(0,o)/r);return t+(e-t)*a}function Or(t,e=1.8){const o=t.slice();for(let r=0;r<t.length;r++)for(let a=0;a<t.length;a++){if(a===r)continue;const s=t[r]/Math.pow(e,Math.abs(r-a));s>o[a]&&(o[a]=s)}return o}const Lr=.25,Br=.12,Nr=2.5,Gr={reference:tt,impulse:tt};function $r(t,e,o){const r=1-Math.exp(-Math.max(0,o)/Lr),a=Math.exp(-Math.max(0,o)/Br),s=x=>{const v=Math.min(1,Math.max(0,e[x]-t.reference[x])*Nr);return{reference:t.reference[x]+(e[x]-t.reference[x])*r,impulse:Math.max(v,t.impulse[x]*a)}},i=s("low"),b=s("mid"),p=s("high");return{reference:{low:i.reference,mid:b.reference,high:p.reference},impulse:{low:i.impulse,mid:b.impulse,high:p.impulse}}}const Ur=6,Kr=3,Vr={slow:0,excitement:0};function jr(t,e,o){const r=1-Math.exp(-Math.max(0,o)/Ur),a=t.slow+(e-t.slow)*r;return{slow:a,excitement:Math.min(1,Math.max(0,(e-a)*Kr))}}function Yr(t){let e=0,o=0;for(let r=0;r<t.length;r++)e+=t[r],o+=t[r]*r;return e<=1e-6||t.length<2?.5:o/e/(t.length-1)}function Xr(t){let e=0,o=0;for(let i=0;i<t.length;i++)e+=t[i],o+=t[i]*i;if(e<=1e-6||t.length<2)return .5;const r=o/e;let a=0;for(let i=0;i<t.length;i++)a+=t[i]*(i-r)*(i-r);a/=e;const s=(t.length-1)/2;return Math.min(1,Math.sqrt(a)/s)}function Jr(t){const e=t.length;if(e<2)return .5;let o=0,r=0;const a=1e-4;for(let b=0;b<e;b++){const p=Math.max(a,t[b]);o+=Math.log(p),r+=p}const s=r/e;if(s<=a*1.5)return .5;const i=Math.exp(o/e);return Math.min(1,i/s)}function Qr(t){return Math.min(1,Math.max(0,t))}const Zr=6,es=1.7,ga=1.4;function ot(t,e){return(t%e+e)%e}function ts(t){const e=Math.min(1,Math.max(0,t));return e*e*(3-2*e)}class as{constructor(){Y(this,"prevBar",null);Y(this,"axisAngle",0);Y(this,"drift",0);Y(this,"inversion",1);Y(this,"shockAge",-1);Y(this,"flash",0);Y(this,"hueJump",0)}render(e,o,r,a){var I,A,E;const s=X(a.bands),i=a.beat,b=(I=i==null?void 0:i.barIndex)!=null?I:null,p=i!==null&&b!==null,x=p?ot(b,4):0,v=p?(x+i.barPhase)/4:null;if(p){if(this.prevBar!==null&&b!==this.prevBar){const R=ot(b,4)===0,D=ot(b,16)===0;this.axisAngle=ot(b,4)*(Math.PI/2),R&&(this.hueJump=(this.hueJump+60)%360,this.flash=.6),D&&(this.inversion*=-1,this.shockAge=0,this.flash=1)}this.prevBar=b}else this.prevBar=null,this.drift+=a.dt*(.2+1.4*s),this.axisAngle=this.drift;this.flash=Math.max(0,this.flash-a.dt*1.6),this.shockAge>=0&&(this.shockAge+=a.dt,this.shockAge>ga&&(this.shockAge=-1));const u=p?[1,1,2,3][x]:1,w=v!==null?ts((v-.75)/.25):0,g=Or(a.spectrum,es),k=g.length,d=o/2,_=r/2,f=Math.min(o,r),n=Pe(s,a.time*Zr+this.hueJump+(a.centroid-.5)*60);if(e.fillStyle=`hsl(${n}, 100%, ${2+5*s+12*this.flash}%)`,e.fillRect(0,0,o,r),k===0){e.globalCompositeOperation="source-over";return}const T=(A=a.params.scale)!=null?A:1,C=f*.46*T,M=k*2,c=C/M/3,l=Math.max(1,(C-c*(M-1))/M),m=f*.42*T,P=this.inversion<0,h=(E=a.params.intensity)!=null?E:1;e.globalCompositeOperation="lighter";for(let R=0;R<u;R++){const D=this.axisAngle+R/u*Math.PI;e.save(),e.translate(d,_),e.rotate(D);const H=.55+.45/u;for(let q=0;q<M;q++){const O=M/2,W=q<O?O-1-q:q-O,F=g[W];if(F<=.004)continue;const z=-C/2+q*(l+c),L=Math.max(1,F*m)*h,N=40+30*F+25*w;if(e.fillStyle=`hsla(${(n+R*12)%360}, 100%, ${Math.min(92,N)}%, ${H})`,P){const U=m;e.fillRect(z,U-L,l,L),e.fillRect(z,-U,l,L)}else e.fillRect(z,-L,l,L*2);const G=Math.min(L,Math.max(2,f*.004));if(e.fillStyle=`hsla(${(n+R*12)%360}, 100%, ${Math.min(95,78+15*w)}%, ${(.5+.5*F)*H})`,P){const U=m;e.fillRect(z,U-L,l,G),e.fillRect(z,-U+L-G,l,G)}else e.fillRect(z,-L,l,G),e.fillRect(z,L-G,l,G)}e.fillStyle=`hsla(${n}, 100%, ${65+25*w}%, ${(.25+.4*w)*H})`,e.fillRect(-C/2,-.5,C,1+2*w),e.restore()}const y=i?Math.pow(1-i.phase,3):a.bands.low*a.bands.low,S=f*(.03+.02*y+.03*a.impulse.low);if(e.fillStyle=`hsla(${n}, 100%, ${55+35*y}%, ${.4+.5*y})`,e.fillRect(d-S,_-S,S*2,S*2),this.shockAge>=0){const R=1-this.shockAge/ga,D=f*(.05+this.shockAge*.9);e.beginPath(),e.arc(d,_,D,0,Math.PI*2),e.strokeStyle=`rgba(255,255,255,${R*.85})`,e.lineWidth=Math.max(2,f*.02*R),e.stroke()}e.globalCompositeOperation="source-over"}}const os={id:"g02-mirror-ladder",name:"g02 mirror-ladder",params:[{id:"scale",label:"field scale",min:.5,max:1.6,step:.05,default:1},{id:"intensity",label:"bar intensity",min:.4,max:2,step:.05,default:1}],create:()=>new as},rs=`
precision highp float;
uniform sampler2D u_prev;
uniform vec2 u_res;
uniform float u_time;
uniform float u_low;
uniform float u_mid;
uniform float u_high;
uniform float u_kick;        // impulse.low
uniform float u_slam;        // SMOOTHED beam-slam envelope (sub-3Hz)
uniform float u_snare;       // impulse.mid: tear trigger
uniform float u_tearY;       // tear scanline position (0..1), healing
uniform float u_tearAmt;     // tear displacement, decays as it heals
uniform float u_vhold;       // vertical-hold sag offset (bass tension)
uniform float u_tracking;    // buildup VHS tracking stress 0..1
uniform float u_noiseBand;   // buildup noise band height creeping from bottom
uniform float u_static;      // SMOOTHED channel-change static burst (one-shot)
uniform float u_retrace;     // retrace line position during a channel change
uniform float u_drop;        // max(drop, energy)
uniform float u_sustain;     // bass-weighted sustained loudness
uniform float u_program;     // 0..3 current program index (integer-valued)
uniform float u_progA;       // program cross-fade previous index
uniform float u_progMix;     // 0..1 fade between progA and program
uniform float u_palette;     // 0..3 palette family (continuous)
uniform float u_warm;        // centroid tint bias
uniform float u_seed;        // genome seed scalar
uniform float u_barrel;      // barrel distortion amount (kick pumps it)
uniform float u_phrase;      // phrase evolution phase for program internals

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

// iq cosine palettes: four saturated families the genome selects between,
// MORPHED not switched. No pure-red two-color pairs (photosafety); bright.
vec3 pal0(float t) { return vec3(0.5, 0.3, 0.55) + vec3(0.5, 0.45, 0.45) * cos(6.28318 * (vec3(1.0, 0.9, 0.8) * t + vec3(0.0, 0.2, 0.45))); }
vec3 pal1(float t) { return vec3(0.2, 0.5, 0.5)  + vec3(0.4, 0.5, 0.5)  * cos(6.28318 * (vec3(0.9, 1.0, 0.9) * t + vec3(0.15, 0.35, 0.6))); }
vec3 pal2(float t) { return vec3(0.5, 0.5, 0.25) + vec3(0.5, 0.45, 0.4) * cos(6.28318 * (vec3(1.0, 0.95, 0.75) * t + vec3(0.05, 0.25, 0.5))); }
vec3 pal3(float t) { return vec3(0.35, 0.3, 0.55) + vec3(0.45, 0.4, 0.5) * cos(6.28318 * (vec3(0.95, 0.9, 1.0) * t + vec3(0.25, 0.1, 0.6))); }

vec3 palette(float t) {
  float x = clamp(u_palette, 0.0, 3.0);
  vec3 c = mix(pal0(t), pal1(t), clamp(x, 0.0, 1.0));
  c = mix(c, pal2(t), clamp(x - 1.0, 0.0, 1.0));
  c = mix(c, pal3(t), clamp(x - 2.0, 0.0, 1.0));
  c += vec3(0.14, 0.02, -0.08) * (u_warm - 0.5) * 1.2;
  return c;
}

// --- The four programs: bold, saturated, high-contrast, always moving. ---

// 0: interference plasma — overlapping wave fronts, mids ripple them.
vec3 progPlasma(vec2 uv) {
  float t = u_time * (0.6 + 1.2 * u_mid) + u_phrase;
  float a = sin((uv.x * 8.0 + t) + sin(uv.y * 6.0 - t * 0.7));
  float b = sin((uv.y * 9.0 - t * 0.9) + sin(uv.x * 7.0 + t * 0.5));
  float f = (a + b) * 0.5;
  float v = 0.5 + 0.5 * f;
  return palette(v * 0.7 + 0.15 + 0.2 * u_high);
}

// 1: rolling color bars gone feral — SMPTE bars that warp and roll with
// mids/highs (rolls slowly so the vertical alternation stays well sub-3Hz).
vec3 progBars(vec2 uv) {
  float roll = u_time * (0.15 + 0.35 * u_mid) + u_phrase * 0.5;
  float warp = 0.12 * sin(uv.y * 5.0 + u_time * 1.3) * (0.5 + u_high);
  float x = fract(uv.x + warp + 0.05 * sin(roll + uv.y * 3.0));
  float bar = floor(x * 7.0) / 7.0;
  return palette(bar + 0.1 * sin(roll) + 0.25 * u_high);
}

// 2: tuned-static aurora — layered noise ridges drifting up, hats sparkle.
vec3 progAurora(vec2 uv) {
  float t = u_time * 0.4 + u_phrase;
  float n = noise(vec2(uv.x * 4.0, uv.y * 3.0 - t)) * 0.6
          + noise(vec2(uv.x * 9.0 + t, uv.y * 6.0 - t * 1.4)) * 0.4;
  float ridge = smoothstep(0.35, 0.75, n + 0.2 * uv.y);
  float shimmer = 0.6 + 0.4 * sin(uv.x * 40.0 + t * 6.0) * u_high;
  return palette(0.2 + 0.6 * n + 0.15 * u_high) * (0.4 + ridge) * shimmer;
}

// 3: raster starburst — radial spokes from center, pulse with mids.
vec3 progStarburst(vec2 uv) {
  vec2 p = uv - 0.5;
  float ang = atan(p.y, p.x);
  float rad = length(p);
  float spokes = 0.5 + 0.5 * sin(ang * 12.0 + u_time * (1.0 + 2.0 * u_mid) + u_phrase);
  float rings = 0.5 + 0.5 * sin(rad * 30.0 - u_time * 3.0 * (0.5 + u_high));
  float v = spokes * (0.5 + 0.5 * rings) * exp(-rad * 1.2);
  return palette(0.15 + v + 0.2 * u_high) * (0.5 + 1.5 * v);
}

vec3 program(float idx, vec2 uv) {
  // Nearest-integer program (no uniform-loop): four bounded branches.
  if (idx < 0.5) return progPlasma(uv);
  if (idx < 1.5) return progBars(uv);
  if (idx < 2.5) return progAurora(uv);
  return progStarburst(uv);
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;

  // ---- Barrel distortion (the tube curvature): pull uv toward center by a
  // radial power. The kick beam-slam pumps the barrel ~2% (u_barrel).
  vec2 cc = uv - 0.5;
  float r2 = dot(cc, cc);
  float barrel = 1.0 + (0.12 + u_barrel) * r2;
  vec2 tubeUv = 0.5 + cc * barrel;

  // ---- Vertical hold sag (bass tension) + subtle horizontal jitter.
  float jitter = (noise(vec2(u_time * 30.0, 0.0)) - 0.5) * 0.004 * (1.0 + 2.0 * u_tracking);
  vec2 cuv = tubeUv + vec2(jitter, u_vhold);

  // Off-tube region reads as the black bezel/darkness.
  float onTube = step(0.0, cuv.x) * step(cuv.x, 1.0) * step(0.0, cuv.y) * step(cuv.y, 1.0);
  cuv = clamp(cuv, 0.0, 1.0);

  // ---- Snare TEAR: a one-line horizontal displacement near u_tearY that
  // heals (u_tearAmt decays). Localized -> photosafety-exempt.
  float tearDist = abs(cuv.y - u_tearY);
  float tearK = exp(-tearDist * 220.0) * u_tearAmt;
  cuv.x = fract(cuv.x + tearK * 0.15 * sign(sin(u_time * 50.0)));

  // ---- VHS tracking stress (buildup): chroma bleed via per-channel uv shear.
  float bleed = (0.002 + 0.010 * u_tracking) * (1.0 + u_drop);
  vec2 br = cuv + vec2(bleed, 0.0);
  vec2 bb = cuv - vec2(bleed, 0.0);

  vec3 content;
  {
    // Program cross-fade (channel change eases progA -> program).
    vec3 cr = mix(program(u_progA, vec2(br.x, br.y)), program(u_program, vec2(br.x, br.y)), u_progMix);
    vec3 cg = mix(program(u_progA, cuv), program(u_program, cuv), u_progMix);
    vec3 cb = mix(program(u_progA, vec2(bb.x, bb.y)), program(u_program, vec2(bb.x, bb.y)), u_progMix);
    content = vec3(cr.r, cg.g, cb.b);
  }

  // ---- Buildup noise band creeping up from the bottom (vivid, not dim).
  float nb = step(cuv.y, u_noiseBand);
  float staticN = hash(vec2(cuv.x * 300.0 + fract(u_time) * 91.0, cuv.y * 300.0 - u_time * 53.0));
  content = mix(content, palette(0.5 + 0.3 * staticN) * (0.6 + 0.8 * staticN), nb * u_tracking * 0.7);

  // ---- Content liveliness: mids/highs keep it moving, sustain lifts it.
  content *= 0.75 + 0.6 * u_sustain + 0.5 * u_drop;

  // ---- Beam SLAM (kick): one SOLID smoothed brightening of the whole raster
  // plus a one-frame scanline thickening. Rides u_slam (sub-3Hz envelope), so
  // it is a pulse, not a strobe. Localized-feeling via a soft center bias.
  float slamBias = 0.6 + 0.4 * (1.0 - r2 * 1.5);
  content *= 1.0 + u_slam * 0.7 * slamBias;

  // ---- CHANNEL-CHANGE static burst: a smoothed one-shot full-field static
  // wipe desaturated toward white (never a saturated-red strobe), plus a
  // bright retrace line sweeping down. u_static is rate-limited (~0.35 s).
  if (u_static > 0.001) {
    float sN = hash(vec2(cuv.x * 640.0 + fract(u_time) * 311.0, cuv.y * 480.0 - u_time * 197.0));
    vec3 snow = mix(vec3(sN), palette(sN) * 1.2, 0.35); // desaturated -> white-ish
    content = mix(content, snow, u_static);
    float rl = exp(-abs(cuv.y - u_retrace) * 90.0);
    content += vec3(0.9, 0.95, 1.0) * rl * u_static * 0.8;
  }

  // ---- CRT scanlines (localized, exempt): darken between scan rows; the
  // slam thickens them for one pulse. Scanline count fixed to the tube.
  float lines = 340.0;
  float scan = 0.5 + 0.5 * sin(cuv.y * lines * 6.28318);
  float scanDepth = 0.35 + 0.25 * u_slam; // slam thickens the dark gaps
  content *= 1.0 - scanDepth * (1.0 - scan);

  // ---- Phosphor RGB triad: each screen column belongs to an R, G or B
  // stripe (aperture-grille look). Localized, exempt.
  float col3 = mod(gl_FragCoord.x, 3.0);
  vec3 triad = vec3(step(col3, 0.5), step(0.5, col3) * step(col3, 1.5), step(1.5, col3));
  triad = mix(vec3(1.0), triad * 1.6, 0.55); // partial mask so it glows, not dims to 1/3
  content *= triad;

  // ---- Beam-glow bloom on bright content (unsharp of the previous frame's
  // bright areas, chroma-preserving). Feedback tap gives the phosphor
  // persistence a real CRT has.
  vec2 pix = 1.0 / u_res;
  vec3 prev = texture2D(u_prev, uv).rgb;
  vec3 blur = (texture2D(u_prev, uv + vec2(pix.x, 0.0)).rgb
    + texture2D(u_prev, uv - vec2(pix.x, 0.0)).rgb
    + texture2D(u_prev, uv + vec2(0.0, pix.y)).rgb
    + texture2D(u_prev, uv - vec2(0.0, pix.y)).rgb) * 0.25;
  float persist = 0.28 + 0.12 * u_tracking;
  vec3 glow = max(vec3(0.0), blur - 0.35) * (0.5 + 0.7 * u_low);
  content += glow * 0.6;
  content = content + prev * persist * 0.5;

  // ---- Corner vignette (localized, exempt): darken the tube corners.
  float vig = smoothstep(0.9, 0.35, length(cc) * 1.3);
  content *= 0.35 + 0.65 * vig;

  // Bezel/darkness outside the tube.
  content *= onTube;

  // Chroma-preserving soft knee (never per-channel clamp).
  float mx = max(content.r, max(content.g, content.b));
  if (mx > 0.92) {
    content *= (0.92 + 0.08 * (1.0 - exp(-(mx - 0.92) * 3.0))) / mx;
  }
  gl_FragColor = vec4(max(content, 0.0), 1.0);
}
`,ss=[{id:"curvature",label:"tube curvature",min:0,max:.3,step:.01,default:.12},{id:"persistence",label:"phosphor persistence",min:.5,max:2,step:.05,default:1},{id:"contentDrive",label:"content liveliness",min:.5,max:2,step:.05,default:1},{id:"glitchiness",label:"channel-change intensity",min:.3,max:2,step:.05,default:1},{id:"warmth",label:"phosphor warmth",min:0,max:1,step:.05,default:.5}];function is(t){let e=(t>>>0)+2654435769;return()=>{e=e+2654435769>>>0;let o=e;return o=Math.imul(o^o>>>16,569420461)>>>0,o=Math.imul(o^o>>>15,1935289751)>>>0,o=(o^o>>>15)>>>0,o/4294967296}}function Rt(t){const e=is(Math.round(t)),o=[0,1,2,3];for(let r=o.length-1;r>0;r--){const a=Math.floor(e()*(r+1)),s=o[r];o[r]=o[a],o[a]=s}return{lineup:o,palette0:e()*3,seed:e()}}function ns(t){const e=t.decks.find(a=>a.channel===t.dominantChannel);if(e&&e.trackId!=null)return e.trackId;let o=null,r=-1;for(const a of t.decks)!a.playing||a.trackId==null||a.level>r&&(r=a.level,o=a.trackId);return o}const ls={id:"g07-crt",name:"g07 crt",hiRes:!0,params:ss,create:()=>{let t=0,e=.5,o=null,r=Rt(1),a=null,s=0,i=0,b=0,p=0,x=0,v=1,u=-1,w=!1,g=0,k=0,d=0,_=0,f=.5,n=0,T=0,C=0,M=0;const c=()=>{p=x,b=(b+1)%r.lineup.length,x=r.lineup[b],v=0,k=1,d=0};return ue({fragment:rs,feedback:!0,uniforms:l=>{var V,le,j,$,oe,he,se,ie,ne,pe,fe,ce;const m=t>0?Math.min(.1,Math.max(0,l.time-t)):.016666666666666666;t=l.time;const P=X(l.bands),h=1-Math.exp(-m/12);e+=(l.centroid-e)*h;const y=ns(l),S=y!=null?y:Math.round((e*4096+P*811)*131);o==null?(o=S,r=Rt(S),a=y,x=r.lineup[0],p=x):y!=null&&y!==a&&(o=S,r=Rt(S),a=y,b=-1,c());const I=Math.min(1,Math.max(0,(l.bands.low-.2)/.5)),A=1-Math.exp(-m/.35);s+=(l.trend.excitement*I-s)*A,i+=(l.trend.excitement*(1-I)-i)*A;const E=Math.min(1,P*1.4),R=Math.max(s,E),D=($=(j=(V=l.beat)==null?void 0:V.ladderBarIndex)!=null?j:(le=l.beat)==null?void 0:le.barIndex)!=null?$:0,H=Math.floor(D/16),q=(he=(oe=l.beat)==null?void 0:oe.barPhase)!=null?he:0,O=(se=l.beat)!=null&&se.bpm?l.beat.bpm/60:2;M+=m*O*.05;const W=s>.5;W&&!w&&c(),w=s>.35,H!==u&&u>=0&&!W&&c(),u=H,v=Math.min(1,v+m/.4),k=Math.max(0,k-m/.35),d=Math.min(1.2,d+m/.35);const F=l.impulse.low;F>g&&(g=F),g=Math.max(0,g-m/.3);const z=(ie=l.params.curvature)!=null?ie:.12;C+=(g*.02-C)*(1-Math.exp(-m/.12));const L=l.impulse.mid;L>.25&&_<.4&&(_=Math.min(1,L),f=.15+.7*Math.random()),_=Math.max(0,_-m/.25);const N=-.02*l.bands.low;T+=(60*(N-n)-9*T)*m,n+=T*m;const B=Math.min(1,i*1.2),K=.18*i;(ne=l.params.persistence)!=null;const ae=(pe=l.params.contentDrive)!=null?pe:1,J=(fe=l.params.glitchiness)!=null?fe:1,te=(ce=l.params.warmth)!=null?ce:.5;return{u_time:l.time,u_low:l.bands.low,u_mid:Math.min(1,l.bands.mid*ae),u_high:Math.min(1,l.bands.high*ae),u_kick:F,u_slam:g,u_snare:L,u_tearY:f,u_tearAmt:_,u_vhold:n,u_tracking:B,u_noiseBand:K,u_static:k*J,u_retrace:d,u_drop:R,u_sustain:E,u_program:x,u_progA:p,u_progMix:v,u_palette:r.palette0,u_warm:.5+(e-.5)*.6+(te-.5)*.8,u_seed:r.seed,u_barrel:z-.12+C,u_phrase:M+q*.2}}})}},cs=t=>{let e=Math.floor(Math.abs(t))+2654435769>>>0;return e=Math.imul(e^e>>>16,569420461)>>>0,e=Math.imul(e^e>>>15,1935289751)>>>0,e=(e^e>>>15)>>>0,e/4294967296},us=`
precision highp float;
uniform sampler2D u_prev;
uniform vec2 u_res;
uniform float u_time;
uniform float u_low;
uniform float u_mid;
uniform float u_high;
uniform float u_kick;
uniform float u_snare;
uniform float u_centroid;
uniform float u_specHue;   // slow-tracked centroid (~1s EMA): dust hue follows spectral content
uniform float u_excite;
uniform float u_zoom;
uniform float u_rotStep;
uniform float u_decay;
uniform float u_seed;
uniform float u_spawn;
uniform float u_dust;
uniform float u_palette;
uniform float u_rippleAge;
uniform float u_rippleAmp;
uniform float u_charge;
uniform float u_beatPulse;
uniform float u_grid;
uniform float u_hueRot;   // DUST FIX v3: per-song hue anchor + slow travel, TURNS 0..1

const vec3 LOW = ${(t=>`vec3(${t[0].toFixed(3)}, ${t[1].toFixed(3)}, ${t[2].toFixed(3)})`)(re[0])};

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

float fbm(vec2 p) {
  float v = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 4; i++) {
    v += amp * noise(p);
    p = p * 2.03 + vec2(17.3, 9.1);
    amp *= 0.5;
  }
  return v;
}

vec3 pal0(float t) { return vec3(0.42, 0.14, 0.10) + vec3(0.42, 0.24, 0.14) * cos(6.28318 * (vec3(1.0, 0.9, 0.6) * t + vec3(0.0, 0.15, 0.25))); }
vec3 pal1(float t) { return vec3(0.45, 0.28, 0.42) + vec3(0.25, 0.35, 0.50) * cos(6.28318 * (vec3(1.0, 0.85, 0.7) * t + vec3(0.0, 0.20, 0.45))); }
vec3 pal2(float t) { return vec3(0.14, 0.36, 0.32) + vec3(0.30, 0.50, 0.45) * cos(6.28318 * (vec3(0.9, 1.0, 0.8) * t + vec3(0.1, 0.30, 0.50))); }
vec3 pal3(float t) { return vec3(0.50, 0.38, 0.24) + vec3(0.48, 0.42, 0.34) * cos(6.28318 * (vec3(1.0, 0.9, 0.8) * t + vec3(0.0, 0.12, 0.25))); }

vec3 palette(float t) {
  float x = clamp(u_palette, 0.0, 3.0);
  vec3 c = mix(pal0(t), pal1(t), clamp(x, 0.0, 1.0));
  c = mix(c, pal2(t), clamp(x - 1.0, 0.0, 1.0));
  c = mix(c, pal3(t), clamp(x - 2.0, 0.0, 1.0));
  return c + vec3(0.10, -0.02, -0.05) * u_excite;
}

// DUST FIX v3: value-preserving hue ROTATION (YIQ chroma plane). rot in TURNS;
// luminance (Y) untouched so gains are unchanged. Negatives clamped.
vec3 hueRotate(vec3 c, float rot) {
  float y = dot(c, vec3(0.299, 0.587, 0.114));
  float i = dot(c, vec3(0.596, -0.274, -0.322));
  float q = dot(c, vec3(0.211, -0.523, 0.312));
  float h = atan(q, i) + rot * 6.28318;
  float chroma = sqrt(i * i + q * q);
  i = chroma * cos(h);
  q = chroma * sin(h);
  return max(vec3(0.0), vec3(
    y + 0.956 * i + 0.621 * q,
    y - 0.272 * i - 0.647 * q,
    y - 1.106 * i - 1.703 * q
  ));
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  float aspect = u_res.x / u_res.y;
  vec2 c = (uv - 0.5) * vec2(aspect, 1.0);
  float r = length(c);
  float ang = atan(c.y, c.x);
  float t = u_time;
  vec2 px = 1.0 / u_res;
  vec2 dirW = r > 1e-4 ? c / r : vec2(0.0);

  // ---- WARP (Tunnel motion): zoom + DIFFERENTIAL rotation — the mouth
  // (large r) spins faster than the throat, shearing walls into spirals.
  float rot = u_rotStep * (0.35 + 1.4 * (1.0 - exp(-r * 2.2)));
  float cs = cos(rot);
  float sn = sin(rot);
  vec2 w = mat2(cs, -sn, sn, cs) * c / u_zoom;
  vec2 churn = (vec2(
    fbm(c * 2.6 + t * 0.12),
    fbm(c * 2.6 + vec2(7.7, 3.1) - t * 0.09)
  ) - 0.5) * (0.0015 + 0.02 * u_mid + 0.012 * u_excite);
  float waveFront = 0.12 + u_rippleAge * 0.95;
  float rippleWave = exp(-pow((r - waveFront) * 9.0, 2.0)) * exp(-u_rippleAge * 2.4) * u_rippleAmp;
  vec2 ripple = dirW * rippleWave * 0.04;
  vec2 src = (w + churn + ripple) / vec2(aspect, 1.0) + 0.5;

  vec2 ab = dirW * (0.0012 + 0.004 * u_excite + 0.003 * u_kick + 0.01 * rippleWave)
    / vec2(aspect, 1.0);
  ab *= u_dust; // fringe amount rides the dust param (human note)
  // fringe fix: hue-steerable fringes -- rotate the field to the anchor
  // frame, split channels there, rotate back. Clamped >= 0 (hueRotate can
  // go slightly negative) so the unsharp feedback loop stays stable.
  float fringeRot = u_hueRot;
  vec3 tapA = texture2D(u_prev, src + ab).rgb;
  vec3 tapC = texture2D(u_prev, src).rgb;
  vec3 tapB = texture2D(u_prev, src - ab).rgb;
  vec3 sampled = max(vec3(0.0), hueRotate(vec3(
    hueRotate(tapA, -fringeRot).r,
    hueRotate(tapC, -fringeRot).g,
    hueRotate(tapB, -fringeRot).b
  ), fringeRot));
  vec3 blur = (texture2D(u_prev, src + vec2(px.x, 0.0)).rgb
    + texture2D(u_prev, src - vec2(px.x, 0.0)).rgb
    + texture2D(u_prev, src + vec2(0.0, px.y)).rgb
    + texture2D(u_prev, src - vec2(0.0, px.y)).rgb) * 0.25;
  vec3 sky = max(vec3(0.0), sampled * 1.35 - blur * 0.35) * u_decay;

  // ---- Fresh medium, injected at (1 - decay).
  vec3 fresh = vec3(0.0);
  float reverb = 1.0 + 2.6 * rippleWave;

  // NEBULA WALLS: the tunnel is made of dust.
  float wall = fbm(vec2(ang * 2.2 + log(r + 0.06) * 3.0 - t * 0.15, r * 6.0 + t * 0.06));
  float cloud = pow(wall, 2.4);
  // SPECTRAL DUST TINT: the wall palette phase is biased by the slow-tracked
  // centroid (u_specHue) so dust hue follows spectral content.
  vec3 dustColor = hueRotate(palette(wall * 1.5 + r * 0.35 + ang * 0.1 + t * 0.012 + u_centroid * 0.4 + u_specHue * 0.8), u_hueRot);
  float midGate = smoothstep(0.03, 0.3, u_mid);
  fresh += dustColor * cloud * smoothstep(0.05, 0.6, r) * (0.1 + 1.2 * u_mid)
    * u_dust * midGate * reverb;

  // ELECTRIC HIGH NEBULA: finer, counter-rotating, shimmering.
  float wisp = fbm(vec2(ang * 6.0 + t * 0.5, r * 11.0 - t * 0.25));
  float shimmer = 0.6 + 0.4 * sin(t * 13.0 + wisp * 24.0);
  // DISTINCT DUST HUE: the high nebula samples the palette at +0.35 phase from
  // the mid wall so the bands read as different dust kinds.
  vec3 electric = hueRotate(palette(0.35 + wall * 1.5 + r * 0.35 + ang * 0.1 + t * 0.012 + u_centroid * 0.4 + u_specHue * 0.8), u_hueRot);
  fresh += electric * pow(wisp, 3.2) * shimmer * smoothstep(0.1, 0.6, r)
    * (0.08 + 1.7 * u_high) * u_dust * reverb;

  // BEAT-LOCKED EMISSION RING at the tunnel MOUTH (the seam); charge runs
  // its color ember -> orange -> white-hot as kicks stack.
  float mouth = 0.30 + 0.05 * u_low;
  float wobble = 0.02 * (0.5 + u_mid) * sin(ang * 6.0 + t * 3.0)
    + 0.015 * u_kick * sin(ang * 11.0 - t * 5.0);
  float ringGlow = exp(-pow((r - mouth - wobble) * 26.0, 2.0));
  float ringCore = exp(-pow((r - mouth - wobble) * 120.0, 2.0));
  vec3 chargeColor = mix(palette(0.02 + u_specHue * 0.5), palette(0.12 + u_specHue * 0.5), clamp(u_charge, 0.0, 1.0));
  chargeColor = mix(chargeColor, vec3(1.0, 0.97, 0.92), clamp(u_charge - 0.6, 0.0, 0.4) * 2.5);
  float emit = mix(0.25 + 0.9 * u_low, u_beatPulse, u_grid);
  fresh += chargeColor * ringGlow * emit * (0.4 + 0.6 * u_charge);
  fresh += mix(chargeColor, vec3(1.0), 0.5) * ringCore * emit * (0.8 + 1.4 * u_kick);

  sky += fresh * (1.0 - u_decay) * (3.0 + 1.6 * u_excite);

  // HIGH-TRANSIENT PUFFS stamped into the feedback at full strength.
  if (u_spawn > 0.01) {
    vec2 sOff = vec2(fract(u_seed * 0.7131) * 21.7, fract(u_seed * 0.3719) * 13.1);
    float puff = pow(fbm(c * 7.0 + sOff), 3.5);
    sky += electric * puff * smoothstep(0.1, 0.55, r) * u_spawn * 0.9;
  }

  // Kick shock at the mouth: the reverb wave's launch point.
  if (u_kick > 0.02) {
    float ringR = 0.12 + 0.05 * u_kick;
    float shock = exp(-pow((r - ringR) * 34.0, 2.0))
      + 0.6 * exp(-pow((r - ringR * 1.7) * 28.0, 2.0));
    sky += mix(palette(0.05 + u_specHue * 0.5), vec3(1.0, 0.9, 0.8), 0.5) * shock * u_kick * (1.1 + 0.8 * u_excite);
    sky *= 1.0 + 0.1 * u_kick;
  }
  if (u_snare > 0.03) {
    float arc = exp(-pow((r - 0.34) * 28.0, 2.0)) * pow(0.5 + 0.5 * sin(ang * 3.0 + u_seed), 2.0);
    sky += palette(0.3 + t * 0.02) * arc * u_snare * 0.7;
  }

  sky += (hash(gl_FragCoord.xy + fract(t) * 191.0) - 0.5) * (0.012 + 0.02 * u_excite);

  vec3 grade = palette(0.35 + u_centroid * 0.2);
  sky = mix(sky, sky * (0.4 + grade * 1.5), 0.22);
  sky *= 0.72 + 0.45 * u_excite;

  float luma = max(sky.r, max(sky.g, sky.b));
  if (luma > 0.8) {
    sky *= (0.8 + 0.2 * (1.0 - exp(-(luma - 0.8) * 3.0))) / luma;
  }
  gl_FragColor = vec4(max(sky, 0.0), 1.0);
}
`,hs={id:"g01-warp-nebula",name:"g01 warp-nebula",hiRes:!0,params:[{id:"dust",label:"dust amount",min:0,max:2,step:.05,default:1},{id:"palette",label:"palette blend (ember→nebula→aurora→solar)",min:0,max:3,step:.05,default:1},{id:"persistence",label:"persistence",min:.5,max:2,step:.05,default:1},{id:"zoom",label:"zoom drive",min:.3,max:2.5,step:.05,default:1},{id:"spin",label:"spin drive",min:0,max:2,step:.05,default:1}],create:()=>{let t=0,e=999,o=0,r=0,a=0,s=0,i=null,b=.5,p=0,x=0,v=null;return ue({fragment:us,feedback:!0,uniforms:u=>{var I,A,E,R,D;const w=u.bands,g=u.impulse,k=u.trend,d=u.beat,_=t>0?Math.min(.1,Math.max(0,u.time-t)):1/60;t=u.time;const f=X(w),n=(I=u.params.zoom)!=null?I:1,T=(A=u.params.spin)!=null?A:1,C=(E=u.params.persistence)!=null?E:1,M=1-Math.exp(-_/.35);a+=(k.excitement-a)*M;const c=Math.max(a,.6*Math.min(1,f*1.4)),l=1+(.12+.5*c+3.5*g.low*(.5+.5*c))*n*_;r=Math.min(1.4,r*Math.exp(-_/2.5)+g.low*.28),e+=_,g.low>.35&&e>.12&&(e=0,o=Math.min(1,g.low*1.2));const m=d?1:0;d?(i!==null&&d.phase<i?s=1:s=Math.max(s,Math.pow(1-d.phase,3)),i=d.phase):i=null,s*=Math.exp(-_/.12);const P=.992-.008*f-.006*a;b+=(u.centroid-b)*(1-Math.exp(-_/1));let h=null,y=-1;for(const H of u.decks)H.level>y&&(y=H.level,h=H.trackId);h!==null&&h!==v&&(v=h,x=cs(h)),p+=(x-p)*(1-Math.exp(-_/2));const S=((p+(b-.5)*.8)%1+1)%1;return{u_time:u.time,u_low:w.low,u_mid:w.mid,u_high:w.high,u_kick:g.low,u_snare:g.mid,u_centroid:u.centroid,u_specHue:b,u_hueRot:S,u_excite:a,u_zoom:l,u_rotStep:(.08+1*w.mid+1.4*g.mid)*T*_,u_decay:Math.min(.998,1-(1-P)/C),u_seed:Math.floor(u.time*20),u_dust:(R=u.params.dust)!=null?R:1,u_palette:(D=u.params.palette)!=null?D:1,u_rippleAge:e,u_rippleAmp:o,u_charge:r,u_beatPulse:Math.min(1,s),u_grid:m,u_spawn:Math.min(1,1.1*g.high+.2*w.high)*(.4+.6*c)/(1+2.2*g.low)}}})}},Ce=5,ps=`
precision highp float;
uniform sampler2D u_prev;
uniform vec2 u_res;
uniform float u_time;
uniform float u_low;
uniform float u_mid;
uniform float u_high;
uniform float u_kick;        // impulse.low -> clutch bite glow
uniform float u_snare;       // impulse.mid -> gear-mesh glints (gated by high)
uniform float u_hat;         // impulse.high -> glint gate
uniform float u_drop;        // smoothed excitement WITH bass
uniform float u_buildup;     // smoothed excitement WITHOUT bass
uniform float u_sustain;     // bass-weighted sustained loudness (max(drop,energy) body)
uniform float u_train;       // master gear-train angle (bpm + clutch advance)
uniform float u_spring;      // wound spring angle (phrase tension), radians
uniform float u_release;     // 0..1 section-boundary release flash of stored angle
uniform float u_spacing;     // orbital spacing (buildup narrows it)
uniform float u_hub;         // 0..1 hub off-center placement bias (already in u_center)
uniform vec2  u_center;      // OFF-CENTER hub location, aspect-space
uniform float u_stageCount;  // active nested stages (masked in the constant loop)
uniform float u_ratio[5];    // per-stage rational bar-length ratio (rate multiplier)
uniform float u_radius[5];   // per-stage orbital radius
uniform float u_teeth[5];    // per-stage fine gear-tooth count
uniform float u_act[5];      // per-stage mechanism activity (24-band grouped)
uniform float u_phase0[5];   // per-stage seeded phase offset
uniform float u_fold;        // symmetry family fold count (rebuilds on section)
uniform float u_palette;     // seed palette family 0..3 (continuous)
uniform float u_warm;        // avg centroid -> palette temperature
uniform float u_sat;         // saturation surge (buildups saturate)
uniform float u_edgeTravel;  // saturated edge-color travel speed (buildup accel)
uniform float u_decay;       // feedback persistence
uniform float u_seed;        // scalar seed for tinting

// iq cosine palettes: four families the seed morphs between (bright/saturated).
vec3 pal0(float t) { return vec3(0.5, 0.28, 0.5)  + vec3(0.5, 0.45, 0.5)  * cos(6.28318 * (vec3(1.0, 0.9, 0.75) * t + vec3(0.0, 0.18, 0.42))); }
vec3 pal1(float t) { return vec3(0.16, 0.44, 0.5) + vec3(0.4, 0.5, 0.45)  * cos(6.28318 * (vec3(0.9, 1.0, 0.85) * t + vec3(0.1, 0.32, 0.55))); }
vec3 pal2(float t) { return vec3(0.55, 0.42, 0.2) + vec3(0.5, 0.42, 0.35) * cos(6.28318 * (vec3(1.0, 0.9, 0.7) * t + vec3(0.0, 0.14, 0.28))); }
vec3 pal3(float t) { return vec3(0.5, 0.12, 0.32) + vec3(0.5, 0.4, 0.45)  * cos(6.28318 * (vec3(1.0, 0.85, 0.9) * t + vec3(0.2, 0.05, 0.55))); }

vec3 palette(float t) {
  float x = clamp(u_palette, 0.0, 3.0);
  vec3 c = mix(pal0(t), pal1(t), clamp(x, 0.0, 1.0));
  c = mix(c, pal2(t), clamp(x - 1.0, 0.0, 1.0));
  c = mix(c, pal3(t), clamp(x - 2.0, 0.0, 1.0));
  c += vec3(0.14, 0.02, -0.08) * (u_warm - 0.5) * 1.3;
  c += vec3(0.16, 0.0, -0.06) * u_drop;
  return c;
}

vec3 saturate(vec3 c, float amt) {
  float l = dot(c, vec3(0.299, 0.587, 0.114));
  return mix(vec3(l), c, amt);
}

// Neon line: distance -> additive glow with a hot core and a soft halo.
float neon(float d, float w) {
  float core = exp(-d * d / (w * w));
  float halo = exp(-d * d / (w * w * 26.0)) * 0.35;
  return core + halo;
}

// SDF of a ring (annulus centre-line) at radius r0.
float ringSDF(vec2 p, float r0) {
  return abs(length(p) - r0);
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  float aspect = u_res.x / u_res.y;
  vec2 p = (uv - 0.5) * vec2(aspect, 1.0);

  // ---- Feedback: gentle inward advection so linework leaves short trails
  // that shear with the train rotation (mechanism motion continuity). Trails
  // are LOCAL to the drawn machinery, not a full-field wash.
  float fbRot = (u_train * 0.02) * (1.0 + u_drop);
  float fcs = cos(fbRot);
  float fsn = sin(fbRot);
  vec2 fp = mat2(fcs, -fsn, fsn, fcs) * (p - u_center) * (1.0 - 0.004 * (1.0 + u_drop)) + u_center;
  vec2 src = fp / vec2(aspect, 1.0) + 0.5;
  vec2 pix = 1.0 / u_res;
  vec3 fed = texture2D(u_prev, src).rgb;
  vec3 blur = (texture2D(u_prev, src + vec2(pix.x, 0.0)).rgb
    + texture2D(u_prev, src - vec2(pix.x, 0.0)).rgb
    + texture2D(u_prev, src + vec2(0.0, pix.y)).rgb
    + texture2D(u_prev, src - vec2(0.0, pix.y)).rgb) * 0.25;
  vec3 trail = max(vec3(0.0), fed * 1.28 - blur * 0.28) * u_decay;

  // ---- Hub-relative coordinate (OFF-CENTER). Everything hangs off the hub.
  vec2 hp = p - u_center;

  vec3 acc = vec3(0.0);

  // The mainspring: an Archimedean spiral coil whose wound angle = u_spring
  // (phrase tension). Drawn as a glowing coil near the hub; tightens toward
  // the phrase end, releases on section boundaries (u_release).
  {
    float ang = atan(hp.y, hp.x);
    float rr = length(hp);
    float turns = 4.0 + 3.0 * clamp(u_spring / 6.28318, 0.0, 2.0);
    // spiral radius for this angle (wrapped): r = a * (angle + k*2pi)
    float a0 = 0.02;
    float pitch = (0.05 + 0.03 * u_hub) / (1.0 + 0.4 * u_buildup); // buildup tightens
    // nearest coil distance via modular angle wrap
    float coilR = mod(rr - a0, pitch);
    float dCoil = min(coilR, pitch - coilR);
    float wound = smoothstep(turns * pitch + a0, a0, rr); // more coil visible when wound
    float spring = neon(dCoil, 0.006) * wound * (0.5 + 0.8 * u_buildup + 1.2 * u_release);
    vec3 springCol = palette(0.1 + 0.2 * u_buildup + u_time * 0.02 * u_edgeTravel);
    acc += springCol * spring * (0.6 + 0.5 * u_mid);
  }

  // ---- Nested orbital stages. Constant loop masked by u_stageCount.
  // Each stage: an eccentric hub + flywheel ring at u_radius[i], turning at
  // the bpm train scaled by its rational ratio; a connecting rod (arm) to the
  // next stage; a fine gear-tooth ring (highs). Kick advance rides in u_train.
  vec2 prevCentre = u_center;      // world-space stage centre (aspect coords are hub-rel here)
  vec2 stageCentre = vec2(0.0);    // hub-relative
  for (int i = 0; i < 5; i++) {
    float fi = float(i);
    float active = step(fi + 0.5, u_stageCount);

    float ratio = u_ratio[i];
    float rad = u_radius[i] * u_spacing;      // buildup narrows spacing
    float teeth = u_teeth[i];
    float act = u_act[i];
    float ph0 = u_phase0[i];

    // Stage angle: master train * this stage's rational ratio. Period-locked.
    float ang = u_train * ratio + ph0;
    vec2 dir = vec2(cos(ang), sin(ang));
    // Eccentricity so hubs are NOT concentric circles (asymmetry + parallax).
    float ecc = 0.6 + 0.4 * sin(ph0 * 2.0);
    vec2 nextCentre = stageCentre + dir * vec2(rad, rad * ecc);

    // Position relative to THIS stage's centre.
    vec2 q = hp - stageCentre;

    // Flywheel ring (LOWS drive the solid eccentric hub/flywheel).
    float wheelR = rad * (0.42 + 0.18 * act);
    float dWheel = ringSDF(q, wheelR);
    float wheelGlow = neon(dWheel, 0.006 + 0.004 * u_low);
    vec3 wheelCol = palette(0.05 * fi + 0.12 * u_low + u_time * 0.015 * u_edgeTravel);
    acc += wheelCol * wheelGlow * active * (0.35 + 1.1 * u_low + 0.7 * act) * (0.6 + 0.6 * u_sustain);

    // Solid eccentric hub: a small filled disc at the stage centre (LOW body).
    float dHub = length(q);
    float hubGlow = exp(-dHub * dHub / (0.0009 + 0.0016 * u_low)) ;
    acc += wheelCol * hubGlow * active * (0.4 + 0.9 * u_low);

    // Spokes: MID articulated arms fanning from the hub to the wheel rim.
    // Folded angular symmetry (the seed's symmetry family, rebuilt on section).
    {
      float aa = atan(q.y, q.x) + ang;              // spokes co-rotate with the stage
      float fold = max(2.0, u_fold);
      float sector = 6.28318 / fold;
      float ad = abs(mod(aa, sector) - sector * 0.5);
      float spoke = neon(ad * (wheelR + 0.001), 0.004);
      float within = smoothstep(wheelR + 0.01, 0.0, dHub); // only inside the wheel
      vec3 armCol = palette(0.4 + 0.1 * fi + u_time * 0.02 * u_edgeTravel);
      acc += armCol * spoke * within * active * (0.3 + 1.4 * u_mid + 0.6 * act);
    }

    // Fine gear teeth (HIGHS): a serrated ring at the wheel rim.
    {
      float aa = atan(q.y, q.x) * teeth;
      float toothMod = abs(fract(aa) - 0.5) * 2.0;   // 0..1 saw
      float dTeeth = abs(dWheel) + toothMod * 0.010;
      float teethGlow = neon(dTeeth, 0.0035) * (0.4 + 1.2 * u_high);
      vec3 teethCol = palette(0.7 + 0.05 * fi + u_time * 0.03 * u_edgeTravel);
      acc += teethCol * teethGlow * active * (0.25 + 0.9 * u_high + 0.5 * act);

      // SNARE GEAR-MESH GLINTS: white-hot metal catching light at the mesh
      // point where this wheel meets the arm to the next stage. Tiny +
      // localized (photosensitivity floor). Gated by snare*hat.
      vec2 meshPt = normalize(nextCentre - stageCentre + 1e-4) * wheelR;
      float dMesh = length(q - meshPt);
      float glint = exp(-dMesh * dMesh / 0.00035);
      float glintGate = u_snare * (0.4 + 0.8 * u_hat);
      acc += mix(vec3(1.0), teethCol, 0.4) * glint * active * glintGate * 1.6;
    }

    // Connecting rod (arm) from this stage centre to the next stage centre:
    // the CONNECTED machinery — no free-floating orbits. Line segment SDF.
    {
      vec2 a = stageCentre;
      vec2 b = nextCentre;
      vec2 pa = hp - a;
      vec2 ba = b - a;
      float h = clamp(dot(pa, ba) / max(1e-4, dot(ba, ba)), 0.0, 1.0);
      float dRod = length(pa - ba * h);
      float rodGlow = neon(dRod, 0.005);
      float nextActive = step(fi + 1.5, u_stageCount);
      vec3 rodCol = palette(0.3 + 0.08 * fi);
      acc += rodCol * rodGlow * active * nextActive * (0.4 + 0.8 * u_mid) * (0.6 + 0.5 * u_sustain);
    }

    // CLUTCH BITE: on a kick, the mesh point between this stage and the next
    // glows as the clutch engages and advances the train (physical, not a
    // flash). Localized to the mesh region.
    {
      vec2 meshPt = (stageCentre + nextCentre) * 0.5;
      float dClutch = length(hp - meshPt);
      float clutch = exp(-dClutch * dClutch / 0.0016) * u_kick;
      acc += palette(0.6 + u_time * 0.05) * clutch * active * (0.9 + 1.2 * u_low);
    }

    stageCentre = nextCentre;
    prevCentre = nextCentre;
  }
  // keep prevCentre referenced (asymmetric silhouette anchor); no-op consumer.
  acc += vec3(0.0) * dot(prevCentre, prevCentre);

  // ---- Section-release burst: a fast expanding ring from the hub marking
  // the stored-angle release + rebuild (localized pulse, exempt from the
  // flash cap; still soft-kneed below).
  {
    float rr = length(hp);
    float radius = 0.04 + (1.0 - u_release) * 0.9;
    float shell = exp(-pow((rr - radius) * 6.0, 2.0));
    acc += palette(0.35 + u_time * 0.08) * shell * u_release * 1.8;
  }

  // Live body: max(drop, energy) sustained; buildups lift too (never dimmed).
  acc *= 0.55 + 1.0 * u_sustain + 0.7 * u_drop + 0.25 * u_buildup;

  // Saturation: buildups saturate; slider bias upstream.
  acc = saturate(acc, clamp(u_sat, 0.0, 2.0));

  // Blend into the trail (feedback continuity), fresh linework on top.
  vec3 outc = trail + acc * (1.0 - u_decay) * 2.6;

  // Chroma-preserving soft knee (never per-channel clamp).
  float mx = max(outc.r, max(outc.g, outc.b));
  if (mx > 0.85) {
    outc *= (0.85 + 0.15 * (1.0 - exp(-(mx - 0.85) * 3.0))) / mx;
  }
  gl_FragColor = vec4(max(outc, 0.0), 1.0);
}
`,ds=[{id:"trainSpeed",label:"gear-train speed",min:.3,max:2.5,step:.05,default:1},{id:"complexity",label:"mechanism complexity",min:.3,max:1.6,step:.05,default:1},{id:"persistence",label:"feedback persistence",min:.5,max:2,step:.05,default:1},{id:"clutch",label:"kick clutch bite",min:.2,max:2.5,step:.05,default:1},{id:"saturation",label:"color saturation",min:.5,max:2,step:.05,default:1}];function _a(t){let e=(t>>>0)+2654435769;return()=>{e=e+2654435769>>>0;let o=e;return o=Math.imul(o^o>>>16,569420461)>>>0,o=Math.imul(o^o>>>15,1935289751)>>>0,o=(o^o>>>15)>>>0,o/4294967296}}const va=[1,.5,.25,2/3,1.5,.125,3];function St(t){const e=_a(Math.round(t)),o=3+Math.floor(e()*(Ce-2)),r=new Float32Array(Ce),a=new Float32Array(Ce),s=new Float32Array(Ce),i=new Float32Array(Ce);let b=.34+e()*.08;for(let _=0;_<Ce;_++)r[_]=va[Math.floor(e()*va.length)]*(_%2===0?1:-1),a[_]=b,b*=.5+e()*.18,s[_]=8+Math.floor(e()*16),i[_]=e()*Math.PI*2;const p=3+Math.floor(e()*5),x=e()*3,v=e()<.5?-1/3:1/3,u=e()<.5?-1/3:1/3,w=(e()-.5)*.12,g=(e()-.5)*.12,k=[v+w,u+g],d=e();return{stageCount:o,ratio:r,radius:a,teeth:s,phase0:i,foldBase:p,palette:x,center:k,seed:d}}function fs(t){const e=t.decks.find(a=>a.channel===t.dominantChannel);if(e&&e.trackId!=null)return e.trackId;let o=null,r=-1;for(const a of t.decks)!a.playing||a.trackId==null||a.level>r&&(r=a.level,o=a.trackId);return o}function ms(t,e,o){var a;const r=t.length||1;for(let s=0;s<Ce;s++){if(s>=e){o[s]=0;continue}const i=Math.floor(s/e*r),b=Math.max(i+1,Math.floor((s+1)/e*r));let p=0;for(let x=i;x<b&&x<r;x++)p+=(a=t[x])!=null?a:0;o[s]=Math.min(1,p/Math.max(1,b-i))}}const gs={id:"g06-orrery",name:"g06 orrery",hiRes:!0,params:ds,create:()=>{let t=0,e=.5,o=0,r=null,a=St(1),s=null,i=-1,b=0,p=0,x=0,v=0;const u=new Float32Array(Ce);let w=0;return ue({fragment:ps,feedback:!0,uniforms:g=>{var L,N,G,U,B,K,ae,J;const k=t>0?Math.min(.1,Math.max(0,g.time-t)):.016666666666666666;t=g.time;const d=X(g.bands),_=(N=(L=g.beat)==null?void 0:L.bpm)!=null?N:0,f=1-Math.exp(-k/15);e+=(g.centroid-e)*f,_&&_>0&&(o+=(_-o)*f);const n=fs(g),T=n!=null?n:Math.round((e*4096+o*7+d*97)*131)||1;r==null?(r=T,a=St(T),s=n):n!=null&&n!==s&&(r=T,a=St(T),s=n,p=1);const C=Math.min(1,Math.max(0,(g.bands.low-.2)/.5)),M=1-Math.exp(-k/.35);x+=(g.trend.excitement*C-x)*M,v+=(g.trend.excitement*(1-C)-v)*M;const c=Math.min(1,Math.max(x,d)*1.35),l=g.beat,m=l?(G=l.ladderBarIndex)!=null?G:l.barIndex:null,P=l?l.barPhase:0,h=l&&m!==null?((m%4+4)%4+P)/4:0,y=m!==null?Math.floor(m/16):-1;y!==i&&i!==-1&&(p=1,a={...a,foldBase:3+Math.floor(_a(r+y*1013)()*5)}),i=y,p=Math.max(0,p-k/.6);const S=(U=g.params.trainSpeed)!=null?U:1,I=o>0?o/60:2,A=(B=g.params.clutch)!=null?B:1;w+=g.impulse.low*A*1.4,w*=Math.exp(-k/.18),b+=k*I*.55*S*(1+.9*x)+w*k+p*k*6;const E=h*h*(Math.PI*2.2)*(1+.8*v)*(1-p),D=((K=g.params.complexity)!=null?K:1)*(1-.28*v+.12*x);ms(g.spectrum,a.stageCount,u);const H=1+2.2*v+.8*x,q=(ae=g.params.persistence)!=null?ae:1,O=.985-.01*v,W=Math.min(.995,1-(1-O)/q),z=((J=g.params.saturation)!=null?J:1)*(.9+.55*v+.35*x);return{u_time:g.time,u_low:g.bands.low,u_mid:g.bands.mid,u_high:g.bands.high,u_kick:g.impulse.low,u_snare:g.impulse.mid,u_hat:g.impulse.high,u_drop:x,u_buildup:v,u_sustain:c,u_train:b,u_spring:E,u_release:p,u_spacing:Math.max(.4,D),u_hub:.5+.5*a.seed,u_center:a.center,u_stageCount:a.stageCount,u_ratio:a.ratio,u_radius:a.radius,u_teeth:a.teeth,u_act:u,u_phase0:a.phase0,u_fold:a.foldBase,u_palette:a.palette,u_warm:e,u_sat:z,u_edgeTravel:H,u_decay:W,u_seed:a.seed}}})}},_s=t=>{let e=Math.floor(Math.abs(t))+2654435769>>>0;return e=Math.imul(e^e>>>16,569420461)>>>0,e=Math.imul(e^e>>>15,1935289751)>>>0,e=(e^e>>>15)>>>0,e/4294967296},vs=`
precision highp float;
uniform sampler2D u_prev;
uniform vec2 u_res;
uniform float u_time;
uniform float u_low;
uniform float u_mid;
uniform float u_high;
uniform float u_kick;
uniform float u_snare;
uniform float u_drop;
uniform float u_buildup;
uniform float u_sustain;
uniform float u_centroid;
uniform float u_decay;
uniform float u_seed;
uniform float u_spawn;      // high-transient nebula puffs
uniform float u_spawnSnare; // snare star powder
uniform float u_zoom;
uniform float u_rotStep;    // signed (genome spin)
uniform float u_charge;     // bass-ring charge
uniform float u_rippleAge;
uniform float u_rippleAmp;
uniform float u_palette;    // genome palette (continuous)
uniform float u_arms;       // genome arm count (eased)
uniform float u_fold;       // kaleidoscope segments (0 = unfolded)
uniform float u_horizonScale;
uniform float u_flash;      // mutation flash
uniform float u_phrase;     // phrase phase 0..1
uniform float u_section;    // section phase 0..1
uniform float u_barWave;    // bar-boundary wave age
uniform float u_beatPump;
uniform float u_dust;
uniform float u_drift;      // dawn-mode upward drift (calm pan)

const float PI = 3.141592653589793;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

float fbm(vec2 p) {
  float v = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 4; i++) {
    v += amp * noise(p);
    p = p * 2.03 + vec2(17.3, 9.1);
    amp *= 0.5;
  }
  return v;
}

vec3 pal0(float t) { return vec3(0.42, 0.14, 0.1) + vec3(0.42, 0.24, 0.14) * cos(6.28318 * (vec3(1.0, 0.9, 0.6) * t + vec3(0.0, 0.15, 0.25))); }
vec3 pal1(float t) { return vec3(0.45, 0.28, 0.42) + vec3(0.25, 0.35, 0.5) * cos(6.28318 * (vec3(1.0, 0.85, 0.7) * t + vec3(0.0, 0.2, 0.45))); }
vec3 pal2(float t) { return vec3(0.14, 0.36, 0.32) + vec3(0.3, 0.5, 0.45) * cos(6.28318 * (vec3(0.9, 1.0, 0.8) * t + vec3(0.1, 0.3, 0.5))); }
vec3 pal3(float t) { return vec3(0.5, 0.38, 0.24) + vec3(0.48, 0.42, 0.34) * cos(6.28318 * (vec3(1.0, 0.9, 0.8) * t + vec3(0.0, 0.12, 0.25))); }

vec3 palette(float t) {
  float x = clamp(u_palette, 0.0, 3.0);
  vec3 c = mix(pal0(t), pal1(t), clamp(x, 0.0, 1.0));
  c = mix(c, pal2(t), clamp(x - 1.0, 0.0, 1.0));
  c = mix(c, pal3(t), clamp(x - 2.0, 0.0, 1.0));
  return c + vec3(0.1, -0.02, -0.05) * u_drop - vec3(0.06, 0.02, -0.04) * u_buildup;
}

float starShape(vec2 f, float size) {
  float d2 = dot(f, f);
  float core = exp(-d2 * 1100.0 / size);
  float halo = exp(-d2 * 140.0 / size) * 0.2;
  float spikes = (exp(-abs(f.x) * 190.0 / size) * exp(-abs(f.y) * 16.0 / size)
    + exp(-abs(f.y) * 190.0 / size) * exp(-abs(f.x) * 16.0 / size)) * 0.55;
  return core + halo + spikes;
}

vec3 starScatter(vec2 c, float density, float sizeScale, float gate, float gain) {
  vec2 q = c * density;
  vec2 cell = floor(q);
  vec2 sc = cell + vec2(fract(u_seed * 0.7131) * 61.7, fract(u_seed * 0.3719) * 43.1);
  vec2 pos = vec2(hash(sc + 1.3), hash(sc.yx + 4.7)) * 0.7 + 0.15;
  vec2 f = fract(q) - pos;
  float on = step(gate - 0.09 * gain, hash(sc * 1.618 + 9.7));
  float size = (0.5 + 1.5 * hash(sc.yx * 2.113)) * sizeScale;
  float bright = 0.4 + 0.6 * hash(sc + 17.9);
  vec3 tint = mix(vec3(0.65, 0.78, 1.0), vec3(1.0, 0.85, 0.6), hash(sc.yx + 29.3));
  return tint * starShape(f, size) * on * bright * gain;
}

uniform float u_hueRot; // fringe fix: per-song hue anchor + slow spectral travel, TURNS 0..1

// fringe fix: value-preserving hue ROTATION in YIQ chroma-plane (dust-v3
// idiom). rot is in TURNS; luminance (Y) is untouched by construction.
vec3 hueRotate(vec3 c, float rot) {
  float y = dot(c, vec3(0.299, 0.587, 0.114));
  float i = dot(c, vec3(0.596, -0.274, -0.322));
  float q = dot(c, vec3(0.211, -0.523, 0.312));
  float h = atan(q, i) + rot * 6.28318;
  float chroma = sqrt(i * i + q * q);
  i = chroma * cos(h);
  q = chroma * sin(h);
  return max(vec3(0.0), vec3(
    y + 0.956 * i + 0.621 * q,
    y - 0.272 * i - 0.647 * q,
    y - 1.106 * i - 1.703 * q
  ));
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  float aspect = u_res.x / u_res.y;
  vec2 c = (uv - 0.5) * vec2(aspect, 1.0);
  float r = length(c);
  float ang = atan(c.y, c.x);
  float t = u_time;
  vec2 px = 1.0 / u_res;
  float anticipation = smoothstep(0.7, 1.0, u_phrase);

  // ---- Section fold on the warp coords: the accumulated universe folds.
  vec2 wc = c;
  if (u_fold > 0.5) {
    float fold = PI / u_fold;
    float fa = abs(mod(ang + t * 0.02, 2.0 * fold) - fold);
    wc = vec2(cos(fa), sin(fa)) * r;
  }

  // ---- Warp: differential rotation + churn + kick ripple + lens.
  float rot = u_rotStep * (0.35 + 1.4 * exp(-r * 2.2));
  float cs = cos(rot);
  float sn = sin(rot);
  vec2 w = mat2(cs, -sn, sn, cs) * wc / u_zoom;
  vec2 dirW = r > 1e-4 ? c / r : vec2(0.0);
  vec2 churn = (vec2(
    fbm(c * 2.6 + t * 0.12),
    fbm(c * 2.6 + vec2(7.7, 3.1) - t * 0.09)
  ) - 0.5) * (0.0016 + 0.014 * u_mid + 0.009 * u_buildup + 0.005 * u_phrase + 0.005 * anticipation);
  float waveFront = 0.16 + u_rippleAge * 0.9;
  float rippleWave = exp(-pow((r - waveFront) * 9.0, 2.0)) * exp(-u_rippleAge * 2.4) * u_rippleAmp;
  vec2 ripple = dirW * rippleWave * 0.03;
  float barFront = 0.15 + u_barWave * 1.1;
  float barWave = exp(-pow((r - barFront) * 10.0, 2.0)) * exp(-u_barWave * 3.0);
  float horizon = (0.14 + 0.1 * u_low) * u_horizonScale * (1.0 + 0.07 * u_charge)
    * (1.0 + 0.04 * u_phrase * sin(t * 2.3));
  float lens = (0.3 * u_low + 1.15 * u_kick) * (1.0 + 0.7 * u_charge) * exp(-pow(r / horizon, 2.0) * 1.4);
  float drag = lens * 0.12;
  float dcs = cos(drag);
  float dsn = sin(drag);
  w = mat2(dcs, -dsn, dsn, dcs) * w;
  // Dawn drift: the whole feedback field is sampled from slightly BELOW,
  // so the accumulated light appears to rise (a slow sunrise pan). Scaled
  // by u_drift (nonzero only as the genome eases into dawn mode).
  vec2 dawn = vec2(0.0, -u_drift * (0.012 + 0.01 * u_sustain));
  vec2 src = (w + churn + ripple + dawn + dirW * barWave * 0.018 + dirW * lens * 0.045)
    / vec2(aspect, 1.0) + 0.5;

  // Aberration + unsharp feedback sample.
  vec2 ab = dirW * (0.001 + 0.003 * u_drop + 0.0022 * u_kick + 0.008 * rippleWave + 0.005 * u_flash)
    / vec2(aspect, 1.0);
  ab *= u_dust; // fringe amount rides the dust param (human note)
  // fringe fix: hue-steerable fringes -- rotate the field to the anchor
  // frame, split channels there, rotate back. Clamped >= 0 (hueRotate can
  // go slightly negative) so the unsharp feedback loop stays stable.
  float fringeRot = u_hueRot;
  vec3 tapA = texture2D(u_prev, src + ab).rgb;
  vec3 tapC = texture2D(u_prev, src).rgb;
  vec3 tapB = texture2D(u_prev, src - ab).rgb;
  vec3 sampled = max(vec3(0.0), hueRotate(vec3(
    hueRotate(tapA, -fringeRot).r,
    hueRotate(tapC, -fringeRot).g,
    hueRotate(tapB, -fringeRot).b
  ), fringeRot));
  vec3 blur = (texture2D(u_prev, src + vec2(px.x, 0.0)).rgb
    + texture2D(u_prev, src - vec2(px.x, 0.0)).rgb
    + texture2D(u_prev, src + vec2(0.0, px.y)).rgb
    + texture2D(u_prev, src - vec2(0.0, px.y)).rgb) * 0.25;
  // Softer unsharp than the parent: calmer edges, longer smear.
  vec3 sky = max(vec3(0.0), sampled * 1.28 - blur * 0.28) * u_decay;

  // ---- Fresh layers (voyage's stack + genome/phrase evolution).
  vec3 fresh = vec3(0.0);
  float volt = (noise(vec2(ang * 14.0 + t * 3.0, t * 22.0)) - 0.5)
    + 0.5 * (noise(vec2(ang * 30.0 - t * 5.0, t * 37.0)) - 0.5);
  float bassWarp = u_low * (0.2 * sin(ang * 3.0 + t * 1.7) + 0.13 * sin(ang * 5.0 - t * 2.3))
    + 0.16 * u_kick * sin(ang * 7.0 + t * 9.0)
    + volt * (0.14 * u_low + 0.32 * u_kick);
  float rc = r * (1.0 - bassWarp * exp(-r * 3.0));
  float centerDim = smoothstep(horizon * 0.45, horizon * 1.2, r);
  vec3 coal = vec3(0.55, 0.07, 0.04);
  float heart = exp(-rc * rc * (260.0 - 130.0 * u_kick));
  fresh += mix(coal, vec3(1.0, 0.8, 0.7), 0.5 * u_kick) * heart * (0.5 + 1.2 * u_low + 1.4 * u_kick);
  float gravity = sin(rc * 46.0 - t * (3.0 + 9.0 * u_low)) * 0.5 + 0.5;
  fresh += mix(coal, vec3(0.9, 0.25, 0.12), 0.5) * pow(gravity, 4.0) * exp(-r * 5.0)
    * u_low * (0.5 + 0.8 * u_kick);
  // Charged horizon ring (evolution: brightens through the phrase).
  float arcJitter = volt * (0.012 + 0.05 * u_kick + 0.022 * u_low);
  float ringGlow = exp(-pow((r - horizon - arcJitter) * 52.0, 2.0));
  float ringCore = exp(-pow((r - horizon - arcJitter) * 210.0, 2.0));
  vec3 chargeColor = mix(vec3(0.9, 0.2, 0.1), vec3(1.0, 0.75, 0.4), clamp(u_charge, 0.0, 1.0));
  chargeColor = mix(chargeColor, vec3(1.0, 0.97, 0.92), clamp(u_charge - 0.6, 0.0, 0.4) * 2.5);
  float ringGain = 1.0 + 0.5 * anticipation;
  fresh += chargeColor * ringGlow * (0.12 + 0.6 * u_low + 1.1 * u_kick + 0.5 * u_charge) * ringGain;
  fresh += mix(chargeColor, vec3(1.0), 0.5 * u_kick) * ringCore
    * (0.3 + 1.3 * smoothstep(0.06, 0.3, u_low) + 2.4 * u_kick + 0.8 * u_charge) * ringGain;
  // Lens streak.
  float streak = exp(-abs(c.y) * 110.0) * exp(-abs(c.x) * (4.5 - 1.5 * u_drop));
  fresh += mix(vec3(0.6, 0.75, 1.0), palette(t * 0.02), 0.65) * streak
    * (0.25 + 1.2 * u_low + 0.8 * u_kick);
  // Dust disk: genome arms, twist TIGHTENS through the phrase, dust
  // swells toward the boundary; bar waves light it as they pass.
  float twist = 4.5 + 2.5 * u_phrase;
  float arm = sin(ang * u_arms + log(r + 0.06) * twist - t * (0.05 + 0.11 * u_phrase)
    + 0.5 * u_mid * sin(ang * 3.0 + r * 6.0 + t * 0.7));
  float lanes = pow(0.5 + 0.5 * arm, 3.0) * smoothstep(0.06, 0.2, r) * exp(-r * 1.8);
  float cloudField = fbm(vec2(ang * 2.2 + r * 3.0 - t * 0.15, r * 5.0 + t * 0.06));
  float cloud = pow(cloudField, 2.4);
  // Palette phase slides across the phrase AND the spectral centroid —
  // brighter material creeps the disk colour warmer/forward (assigned
  // tech: centroid drives the melodic colour drift).
  vec3 diskColor = palette(cloudField * 1.5 + r * 0.35 + ang * 0.1 + u_centroid * 0.55 + u_phrase * 0.35);
  float reverb = 1.0 + 2.6 * rippleWave + 2.2 * barWave;
  float midGate = smoothstep(0.04, 0.3, u_mid);
  float dustSwell = u_dust * (0.75 + 0.5 * u_phrase);
  fresh += diskColor * lanes * (0.1 + 1.05 * u_mid) * (0.5 + cloud) * dustSwell * centerDim * midGate * reverb;
  fresh += diskColor * cloud * exp(-r * 2.4) * u_mid * 0.45 * dustSwell * centerDim * midGate * reverb;
  // Electric high nebula + shimmer.
  float wisp = fbm(vec2(ang * 6.0 - t * 0.5, r * 10.0 + t * 0.25));
  float shimmer = 0.6 + 0.4 * sin(t * 13.0 + wisp * 24.0);
  vec3 electric = mix(vec3(0.4, 0.9, 1.0), palette(0.6 + t * 0.03), 0.65);
  fresh += electric * pow(wisp, 3.2) * shimmer * smoothstep(0.12, 0.5, r)
    * (0.06 + 1.45 * u_high) * u_dust * reverb;
  // Section omen: a ring closing in from the screen edge over the last
  // bars. CALM cut — thinner, dimmer, and later than the parent so the
  // section change is a hint, not a warning.
  float omen = smoothstep(0.87, 1.0, u_section);
  if (omen > 0.001) {
    float omenR = 1.15 - 0.75 * omen;
    fresh += palette(0.5) * exp(-pow((r - omenR) * 34.0, 2.0)) * omen * 0.42;
  }
  // Anticipation shimmer: the last bar of a phrase flickers (gentler).
  fresh *= 1.0 + 0.08 * anticipation * sin(t * 25.0);
  // Longer persistence: inject fresh light more softly so trails dominate.
  sky += fresh * (1.0 - u_decay) * (3.0 + 1.2 * u_sustain);

  // ---- Stamps.
  if (u_spawn > 0.01) {
    vec2 sOff = vec2(fract(u_seed * 0.7131) * 21.7, fract(u_seed * 0.3719) * 13.1);
    float puff = pow(fbm(c * 7.0 + sOff), 3.5);
    sky += electric * puff * smoothstep(0.1, 0.4, r) * u_spawn * 0.9;
  }
  if (u_spawnSnare > 0.003) {
    sky += starScatter(c + 11.3, 16.0, 2.8, 0.984, u_spawnSnare * 1.2)
      * smoothstep(0.05, 0.18, r) * mix(vec3(1.0), palette(0.15), 0.45);
  }
  if (u_kick > 0.02) {
    float ringR = 0.1 + 0.05 * u_kick;
    float shock = exp(-pow((r - ringR) * 38.0, 2.0))
      + 0.6 * exp(-pow((r - ringR * 1.7) * 30.0, 2.0));
    sky += mix(coal, vec3(1.0, 0.9, 0.8), 0.6) * shock * u_kick * (1.15 + 0.8 * u_drop);
    sky *= 1.0 + 0.1 * u_kick;
  }

  // Mutation flash, grain, grade, dynamics, knee.
  sky += palette(0.4) * u_flash * 0.24 * (1.0 - smoothstep(0.0, 0.9, r));
  sky += (hash(gl_FragCoord.xy + fract(t) * 191.0) - 0.5) * (0.01 + 0.016 * u_drop);
  // Centroid biases the grade too: bright tracks grade warmer/lighter.
  vec3 grade = palette(0.35 + u_centroid * 0.3);
  sky = mix(sky, sky * (0.4 + grade * 1.5), 0.24);
  sky *= (0.7 + 0.38 * max(u_drop, u_sustain) - 0.05 * u_buildup) * (1.0 + 0.06 * u_beatPump);
  float m = max(sky.r, max(sky.g, sky.b));
  if (m > 0.8) {
    // Chroma-preserving soft knee.
    sky *= (0.8 + 0.2 * (1.0 - exp(-(m - 0.8) * 3.0))) / m;
  }
  gl_FragColor = vec4(max(sky, 0.0), 1.0);
}
`,At=[2,3,5],ba=[0,6,8],bs=4,xa=3,xs={id:"g01-odyssey-drift",name:"g01 odyssey-drift",hiRes:!0,params:[{id:"dust",label:"dust amount",min:0,max:2,step:.05,default:.85},{id:"speed",label:"flight speed",min:.2,max:2.5,step:.05,default:.6},{id:"chaos",label:"mutation chaos",min:0,max:2,step:.05,default:.65}],create:()=>{let t=.5,e=0,o=0,r=null,a=Math.floor(Math.random()*4),s=a,i=0,b=At[0],p=0,x=0,v=0,u=1,w=1,g=1,k=0,d=99,_=null,f=0,n=999,T=0,C=0,M=0,c=0,l=-99,m=0,P=0;return ue({fragment:vs,feedback:!0,uniforms:h=>{var he,se,ie;const y=P>0?Math.min(.1,Math.max(0,h.time-P)):.016666666666666666;P=h.time;const S=X(h.bands),I=h.beat,A=(he=h.params.chaos)!=null?he:.65,E=Math.min(1,Math.max(0,(h.bands.low-.2)/.5)),R=1-Math.exp(-y/.35);C+=(h.trend.excitement*E-C)*R,M+=(h.trend.excitement*(1-E)-M)*R;const D=Math.min(1,S*1.4),H=Math.max(C,.7*D);if(C>.45&&c<=.45&&h.time-l>8&&(l=h.time,x=0,p=0,a=(a+2)%4,w=1.2,k=Math.min(1.4,1.2*A)),c=C,S<.15?m+=y:m=0,m>2.5&&x!==xa&&(x=xa,p=0,k=Math.max(k,.2*A)),I){if(_!==null&&I.barIndex!==_){d=0;const ne=(I.barIndex%4+4)%4===0,pe=(I.barIndex%16+16)%16===0;ne&&(a=(a+1)%4,i=(i+1)%At.length,k=Math.max(k,.5*A)),pe&&(H>.5?(x=0,p=1+Math.floor(Math.random()*2)):(x=(x+1)%bs,p=(p+1)%ba.length),u*=-1,w=1+(Math.random()-.35)*.6*A,k=Math.min(1.2,.85*A))}_=I.barIndex}else _=null;const q=1-Math.exp(-y/1.3),O=1-Math.exp(-y/.6);s+=(a-s)*q,b+=(At[i]-b)*O,v+=(x-v)*q,g+=(w-g)*O,k=Math.max(0,k-y*1.4),d+=y,f=Math.min(1.4,f*Math.exp(-y/2.5)+h.impulse.low*.28),n+=y,h.impulse.low>.35&&n>.12&&(n=0,T=Math.min(1,h.impulse.low*1.2));const W=(se=h.params.speed)!=null?se:.6,F=Math.max(0,1-Math.abs(v)),z=Math.max(0,1-Math.abs(v-1)),L=Math.max(0,1-Math.abs(v-2)),N=Math.max(0,1-Math.abs(v-3)),G=I?((I.barIndex%4+4)%4+I.barPhase)/4:0,U=1+(.06+.55*H+3*h.impulse.low*(.5+.5*H))*(.85+.3*G)*W*y,B=1-(.035+.2*S)*W*y+2*h.impulse.low*W*y*.5,K=1+.4*h.impulse.low*W*y,ae=1+(.02+.12*D)*W*y,J=(.04+.42*h.bands.mid+.2*D)*W*y,te=N*(.6+.8*D)*(.6+.8*W),V=G,le=I?((I.barIndex%16+16)%16+I.barPhase)/16:0;t+=(h.centroid-t)*(1-Math.exp(-y/1));let j=null,$=-1;for(const ne of h.decks)ne.level>$&&($=ne.level,j=ne.trackId);return j!==null&&j!==r&&(r=j,o=_s(j)),e+=(o-e)*(1-Math.exp(-y/2)),{u_hueRot:((e+(t-.5)*.8)%1+1)%1,u_time:h.time,u_low:h.bands.low,u_mid:h.bands.mid,u_high:h.bands.high,u_kick:h.impulse.low,u_snare:h.impulse.mid,u_drop:C,u_buildup:M,u_sustain:D,u_centroid:h.centroid,u_decay:Math.min(.999,.995-.006*S-.006*M),u_seed:Math.floor(h.time*20),u_spawn:Math.min(1,1.15*h.impulse.high+.2*h.bands.high)*(.4+.6*Math.max(C,D))/(1+1.8*M)/(1+2.2*h.impulse.low),u_spawnSnare:Math.min(1,.95*h.impulse.mid)*(.5+.5*Math.max(C,D))/(1+.8*M)/(1+2.2*h.impulse.low),u_zoom:F*U+z*B+L*K+N*ae,u_rotStep:u*J*(1+2.2*L)*(1-.7*N),u_charge:f,u_rippleAge:n,u_rippleAmp:T,u_palette:s,u_arms:b,u_fold:ba[p],u_horizonScale:g,u_flash:k,u_phrase:V,u_section:le,u_barWave:d,u_beatPump:I?Math.pow(1-I.phase,2):0,u_dust:(ie=h.params.dust)!=null?ie:.85,u_drift:te}}})}},ws=t=>{let e=Math.floor(Math.abs(t))+2654435769>>>0;return e=Math.imul(e^e>>>16,569420461)>>>0,e=Math.imul(e^e>>>15,1935289751)>>>0,e=(e^e>>>15)>>>0,e/4294967296},ks=["precision highp float;","uniform sampler2D u_prev;","uniform vec2 u_res;","uniform float u_time;","uniform float u_low;","uniform float u_mid;","uniform float u_high;","uniform float u_kick;","uniform float u_snare;","uniform float u_drop;","uniform float u_buildup;","uniform float u_sustain;","uniform float u_centroid;","uniform float u_decay;","uniform float u_seed;","uniform float u_spawn;","uniform float u_spawnSnare;","uniform float u_zoom;","uniform float u_rotStep;","uniform float u_charge;","uniform float u_rippleAge;","uniform float u_rippleAmp;","uniform float u_palette;","uniform float u_arms;","uniform float u_fold;","uniform float u_horizonScale;","uniform float u_flash;","uniform float u_phrase;","uniform float u_section;","uniform float u_barWave;","uniform float u_beatPump;","uniform float u_dust;","uniform float u_crackHeal;","uniform float u_crackAmt;","uniform vec2  u_crackCenter;","uniform float u_crackDrop;","","const float PI = 3.141592653589793;","","float hash(vec2 p) {","  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);","}","","float noise(vec2 p) {","  vec2 i = floor(p);","  vec2 f = fract(p);","  vec2 u = f * f * (3.0 - 2.0 * f);","  return mix(","    mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),","    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),","    u.y","  );","}","","float fbm(vec2 p) {","  float v = 0.0;","  float amp = 0.5;","  for (int i = 0; i < 4; i++) {","    v += amp * noise(p);","    p = p * 2.03 + vec2(17.3, 9.1);","    amp *= 0.5;","  }","  return v;","}","","vec3 pal0(float t) { return vec3(0.42, 0.14, 0.1) + vec3(0.42, 0.24, 0.14) * cos(6.28318 * (vec3(1.0, 0.9, 0.6) * t + vec3(0.0, 0.15, 0.25))); }","vec3 pal1(float t) { return vec3(0.45, 0.28, 0.42) + vec3(0.25, 0.35, 0.5) * cos(6.28318 * (vec3(1.0, 0.85, 0.7) * t + vec3(0.0, 0.2, 0.45))); }","vec3 pal2(float t) { return vec3(0.14, 0.36, 0.32) + vec3(0.3, 0.5, 0.45) * cos(6.28318 * (vec3(0.9, 1.0, 0.8) * t + vec3(0.1, 0.3, 0.5))); }","vec3 pal3(float t) { return vec3(0.5, 0.38, 0.24) + vec3(0.48, 0.42, 0.34) * cos(6.28318 * (vec3(1.0, 0.9, 0.8) * t + vec3(0.0, 0.12, 0.25))); }","","vec3 palette(float t) {","  float x = clamp(u_palette, 0.0, 3.0);","  vec3 c = mix(pal0(t), pal1(t), clamp(x, 0.0, 1.0));","  c = mix(c, pal2(t), clamp(x - 1.0, 0.0, 1.0));","  c = mix(c, pal3(t), clamp(x - 2.0, 0.0, 1.0));","  return c + vec3(0.1, -0.02, -0.05) * u_drop - vec3(0.06, 0.02, -0.04) * u_buildup;","}","","float starShape(vec2 f, float size) {","  float d2 = dot(f, f);","  float core = exp(-d2 * 1100.0 / size);","  float halo = exp(-d2 * 140.0 / size) * 0.2;","  float spikes = (exp(-abs(f.x) * 190.0 / size) * exp(-abs(f.y) * 16.0 / size)","    + exp(-abs(f.y) * 190.0 / size) * exp(-abs(f.x) * 16.0 / size)) * 0.55;","  return core + halo + spikes;","}","","vec3 starScatter(vec2 c, float density, float sizeScale, float gate, float gain) {","  vec2 q = c * density;","  vec2 cell = floor(q);","  vec2 sc = cell + vec2(fract(u_seed * 0.7131) * 61.7, fract(u_seed * 0.3719) * 43.1);","  vec2 pos = vec2(hash(sc + 1.3), hash(sc.yx + 4.7)) * 0.7 + 0.15;","  vec2 f = fract(q) - pos;","  float on = step(gate - 0.09 * gain, hash(sc * 1.618 + 9.7));","  float size = (0.5 + 1.5 * hash(sc.yx * 2.113)) * sizeScale;","  float bright = 0.4 + 0.6 * hash(sc + 17.9);","  vec3 tint = mix(vec3(0.65, 0.78, 1.0), vec3(1.0, 0.85, 0.6), hash(sc.yx + 29.3));","  return tint * starShape(f, size) * on * bright * gain;","}","","// ---- SCREEN-SPACE CRACKS (replaces the kick shockwave rings). A radial","// crack web centered on the strike point: crackWeb returns the nearest-","// crack proximity in x (1 on a fracture line, 0 away) and the along-line","// refraction direction sign in y. Radial spokes + a jittered web give the","// tempered-glass look; the web extent grows with strength and shrinks as","// it heals.","vec2 crackWeb(vec2 p, float strength, float extent) {","  float rr = length(p);","  float a = atan(p.y, p.x);","  // Radial spokes: a set of fracture rays at pseudo-random angles.","  float spokeN = 7.0 + floor(strength * 6.0);","  float wedge = 2.0 * PI / spokeN;","  float jitter = (noise(vec2(a * 3.0, rr * 6.0)) - 0.5) * 0.35;","  float aw = mod(a + jitter, wedge) - 0.5 * wedge;","  float spoke = exp(-pow(aw * rr * 22.0, 2.0));","  // Concentric fracture rings (the glass buckles at radii).","  float rings = exp(-pow(sin(rr * (18.0 + 10.0 * strength)) * 3.0, 2.0)) * smoothstep(0.0, 0.1, rr);","  // Web falls off beyond the crack extent (the strike does not cover all).","  float reach = smoothstep(extent, extent * 0.3, rr);","  float web = max(spoke, rings * 0.7) * reach;","  // Refraction sign flips across the spoke centerline.","  float side = sign(aw);","  return vec2(web, side);","}","","uniform float u_hueRot; // fringe fix: per-song hue anchor + slow spectral travel, TURNS 0..1","","// fringe fix: value-preserving hue ROTATION in YIQ chroma-plane (dust-v3","// idiom). rot is in TURNS; luminance (Y) is untouched by construction.","vec3 hueRotate(vec3 c, float rot) {","  float y = dot(c, vec3(0.299, 0.587, 0.114));","  float i = dot(c, vec3(0.596, -0.274, -0.322));","  float q = dot(c, vec3(0.211, -0.523, 0.312));","  float h = atan(q, i) + rot * 6.28318;","  float chroma = sqrt(i * i + q * q);","  i = chroma * cos(h);","  q = chroma * sin(h);","  return max(vec3(0.0), vec3(","    y + 0.956 * i + 0.621 * q,","    y - 0.272 * i - 0.647 * q,","    y - 1.106 * i - 1.703 * q","  ));","}","","void main() {","  vec2 uv = gl_FragCoord.xy / u_res;","  float aspect = u_res.x / u_res.y;","  vec2 c = (uv - 0.5) * vec2(aspect, 1.0);","  float r = length(c);","  float ang = atan(c.y, c.x);","  float t = u_time;","  vec2 px = 1.0 / u_res;","  float anticipation = smoothstep(0.7, 1.0, u_phrase);","","  // ---- Crack field, computed first so it can refract the feedback src.","  // Strength decays as the web heals (bar phase) and swells with drops","  // (phrase-scale full-screen fracture).","  float heal = clamp(u_crackHeal, 0.0, 1.0);","  float barCrack = u_crackAmt * (1.0 - heal);","  float dropCrack = u_crackDrop;","  float crackStrength = clamp(barCrack + dropCrack, 0.0, 1.6);","  // Bar strike wanders to the travel point; the drop fracture spans full","  // screen from center.","  vec2 pBar = c - u_crackCenter;","  float extentBar = 0.25 + 0.6 * u_crackAmt;","  vec2 webBar = crackWeb(pBar, barCrack, extentBar) * step(0.001, barCrack);","  vec2 webDrop = crackWeb(c, dropCrack, 1.6) * step(0.001, dropCrack);","  float crack = max(webBar.x * barCrack, webDrop.x * dropCrack);","  float crackSide = webBar.x > webDrop.x ? webBar.y : webDrop.y;","  vec2 crackDir = r > 1e-4 ? c / r : vec2(1.0, 0.0);","  // Refraction offset: displace the scene sideways across each fracture.","  vec2 crackRefract = crackDir * crackSide * crack * 0.02;","","  vec2 wc = c;","  if (u_fold > 0.5) {","    float fold = PI / u_fold;","    float fa = abs(mod(ang + t * 0.02, 2.0 * fold) - fold);","    wc = vec2(cos(fa), sin(fa)) * r;","  }","","  float rot = u_rotStep * (0.35 + 1.4 * exp(-r * 2.2));","  float cs = cos(rot);","  float sn = sin(rot);","  vec2 w = mat2(cs, -sn, sn, cs) * wc / u_zoom;","  vec2 dirW = r > 1e-4 ? c / r : vec2(0.0);","  vec2 churn = (vec2(","    fbm(c * 2.6 + t * 0.12),","    fbm(c * 2.6 + vec2(7.7, 3.1) - t * 0.09)","  ) - 0.5) * (0.002 + 0.018 * u_mid + 0.012 * u_buildup + 0.006 * u_phrase + 0.006 * anticipation);","  float waveFront = 0.16 + u_rippleAge * 0.9;","  float rippleWave = exp(-pow((r - waveFront) * 9.0, 2.0)) * exp(-u_rippleAge * 2.4) * u_rippleAmp;","  vec2 ripple = dirW * rippleWave * 0.035;","  float barFront = 0.15 + u_barWave * 1.1;","  float barWave = exp(-pow((r - barFront) * 10.0, 2.0)) * exp(-u_barWave * 3.0);","  float horizon = (0.14 + 0.1 * u_low) * u_horizonScale * (1.0 + 0.07 * u_charge)","    * (1.0 + 0.04 * u_phrase * sin(t * 2.3));","  float lens = (0.3 * u_low + 1.15 * u_kick) * (1.0 + 0.7 * u_charge) * exp(-pow(r / horizon, 2.0) * 1.4);","  float drag = lens * 0.12;","  float dcs = cos(drag);","  float dsn = sin(drag);","  w = mat2(dcs, -dsn, dsn, dcs) * w;","  vec2 src = (w + churn + ripple + crackRefract + dirW * barWave * 0.02 + dirW * lens * 0.045)","    / vec2(aspect, 1.0) + 0.5;","","  vec2 ab = dirW * (0.0012 + 0.004 * u_drop + 0.003 * u_kick + 0.01 * rippleWave + 0.006 * u_flash)","    / vec2(aspect, 1.0);","  ab *= u_dust; // fringe amount rides the dust param (human note)","  // fringe fix: hue-steerable fringes -- rotate the field to the anchor","  // frame, split channels there, rotate back. Clamped >= 0 (hueRotate can","  // go slightly negative) so the unsharp feedback loop stays stable.","  float fringeRot = u_hueRot;","  vec3 tapA = texture2D(u_prev, src + ab).rgb;","  vec3 tapC = texture2D(u_prev, src).rgb;","  vec3 tapB = texture2D(u_prev, src - ab).rgb;","  vec3 sampled = max(vec3(0.0), hueRotate(vec3(","    hueRotate(tapA, -fringeRot).r,","    hueRotate(tapC, -fringeRot).g,","    hueRotate(tapB, -fringeRot).b","  ), fringeRot));","  vec3 blur = (texture2D(u_prev, src + vec2(px.x, 0.0)).rgb","    + texture2D(u_prev, src - vec2(px.x, 0.0)).rgb","    + texture2D(u_prev, src + vec2(0.0, px.y)).rgb","    + texture2D(u_prev, src - vec2(0.0, px.y)).rgb) * 0.25;","  vec3 sky = max(vec3(0.0), sampled * 1.35 - blur * 0.35) * u_decay;","","  vec3 fresh = vec3(0.0);","  float volt = (noise(vec2(ang * 14.0 + t * 3.0, t * 22.0)) - 0.5)","    + 0.5 * (noise(vec2(ang * 30.0 - t * 5.0, t * 37.0)) - 0.5);","  float bassWarp = u_low * (0.2 * sin(ang * 3.0 + t * 1.7) + 0.13 * sin(ang * 5.0 - t * 2.3))","    + 0.16 * u_kick * sin(ang * 7.0 + t * 9.0)","    + volt * (0.14 * u_low + 0.32 * u_kick);","  float rc = r * (1.0 - bassWarp * exp(-r * 3.0));","  float centerDim = smoothstep(horizon * 0.45, horizon * 1.2, r);","  vec3 coal = vec3(0.55, 0.07, 0.04);","  float heart = exp(-rc * rc * (260.0 - 130.0 * u_kick));","  fresh += mix(coal, vec3(1.0, 0.8, 0.7), 0.5 * u_kick) * heart * (0.5 + 1.2 * u_low + 1.4 * u_kick);","  float gravity = sin(rc * 46.0 - t * (3.0 + 9.0 * u_low)) * 0.5 + 0.5;","  fresh += mix(coal, vec3(0.9, 0.25, 0.12), 0.5) * pow(gravity, 4.0) * exp(-r * 5.0)","    * u_low * (0.5 + 0.8 * u_kick);","  float arcJitter = volt * (0.012 + 0.05 * u_kick + 0.022 * u_low);","  float ringGlow = exp(-pow((r - horizon - arcJitter) * 52.0, 2.0));","  float ringCore = exp(-pow((r - horizon - arcJitter) * 210.0, 2.0));","  vec3 chargeColor = mix(vec3(0.9, 0.2, 0.1), vec3(1.0, 0.75, 0.4), clamp(u_charge, 0.0, 1.0));","  chargeColor = mix(chargeColor, vec3(1.0, 0.97, 0.92), clamp(u_charge - 0.6, 0.0, 0.4) * 2.5);","  float ringGain = 1.0 + 0.5 * anticipation;","  fresh += chargeColor * ringGlow * (0.12 + 0.6 * u_low + 1.1 * u_kick + 0.5 * u_charge) * ringGain;","  fresh += mix(chargeColor, vec3(1.0), 0.5 * u_kick) * ringCore","    * (0.3 + 1.3 * smoothstep(0.06, 0.3, u_low) + 2.4 * u_kick + 0.8 * u_charge) * ringGain;","  float streak = exp(-abs(c.y) * 110.0) * exp(-abs(c.x) * (4.5 - 1.5 * u_drop));","  fresh += mix(vec3(0.6, 0.75, 1.0), palette(t * 0.02), 0.65) * streak","    * (0.25 + 1.2 * u_low + 0.8 * u_kick);","  float twist = 4.5 + 2.5 * u_phrase;","  float arm = sin(ang * u_arms + log(r + 0.06) * twist - t * (0.06 + 0.14 * u_phrase)","    + 0.5 * u_mid * sin(ang * 3.0 + r * 6.0 + t * 0.7));","  float lanes = pow(0.5 + 0.5 * arm, 3.0) * smoothstep(0.06, 0.2, r) * exp(-r * 1.8);","  float cloudField = fbm(vec2(ang * 2.2 + r * 3.0 - t * 0.15, r * 5.0 + t * 0.06));","  float cloud = pow(cloudField, 2.4);","  vec3 diskColor = palette(cloudField * 1.5 + r * 0.35 + ang * 0.1 + u_centroid * 0.4 + u_phrase * 0.35);","  float reverb = 1.0 + 2.6 * rippleWave + 2.2 * barWave;","  float midGate = smoothstep(0.04, 0.3, u_mid);","  float dustSwell = u_dust * (0.75 + 0.5 * u_phrase);","  fresh += diskColor * lanes * (0.1 + 1.05 * u_mid) * (0.5 + cloud) * dustSwell * centerDim * midGate * reverb;","  fresh += diskColor * cloud * exp(-r * 2.4) * u_mid * 0.45 * dustSwell * centerDim * midGate * reverb;","  float wisp = fbm(vec2(ang * 6.0 - t * 0.5, r * 10.0 + t * 0.25));","  float shimmer = 0.6 + 0.4 * sin(t * 13.0 + wisp * 24.0);","  vec3 electric = mix(vec3(0.4, 0.9, 1.0), palette(0.6 + t * 0.03), 0.65);","  fresh += electric * pow(wisp, 3.2) * shimmer * smoothstep(0.12, 0.5, r)","    * (0.06 + 1.45 * u_high) * u_dust * reverb;","  float omen = smoothstep(0.8, 1.0, u_section);","  if (omen > 0.001) {","    float omenR = 1.15 - 0.75 * omen;","    fresh += palette(0.5) * exp(-pow((r - omenR) * 26.0, 2.0)) * omen * 0.8;","  }","  fresh *= 1.0 + 0.12 * anticipation * sin(t * 25.0);","  sky += fresh * (1.0 - u_decay) * (3.0 + 1.2 * u_sustain);","","  if (u_spawn > 0.01) {","    vec2 sOff = vec2(fract(u_seed * 0.7131) * 21.7, fract(u_seed * 0.3719) * 13.1);","    float puff = pow(fbm(c * 7.0 + sOff), 3.5);","    sky += electric * puff * smoothstep(0.1, 0.4, r) * u_spawn * 0.9;","  }","  if (u_spawnSnare > 0.003) {","    sky += starScatter(c + 11.3, 16.0, 2.8, 0.984, u_spawnSnare * 1.2)","      * smoothstep(0.05, 0.18, r) * mix(vec3(1.0), palette(0.15), 0.45);","  }","  // SCREEN-SPACE CRACKS (was the kick shockwave ring): draw the fracture","  // lines as localized bright glass edges. Localized only -> photosafe;","  // no full-field flash, and the palette keeps it off saturated-red.","  if (crack > 0.001) {","    vec3 crackCol = mix(palette(0.2 + u_centroid * 0.3), vec3(0.85, 0.95, 1.0), 0.5);","    sky += crackCol * crack * (0.5 + 0.7 * u_kick + 0.5 * dropCrack);","  }","","  sky += palette(0.4) * u_flash * 0.24 * (1.0 - smoothstep(0.0, 0.9, r));","  sky += (hash(gl_FragCoord.xy + fract(t) * 191.0) - 0.5) * (0.012 + 0.02 * u_drop);","  vec3 grade = palette(0.35 + u_centroid * 0.2);","  sky = mix(sky, sky * (0.4 + grade * 1.5), 0.24);","  sky *= (0.7 + 0.38 * max(u_drop, u_sustain) - 0.05 * u_buildup) * (1.0 + 0.06 * u_beatPump);","  float m = max(sky.r, max(sky.g, sky.b));","  if (m > 0.8) {","    sky *= (0.8 + 0.2 * (1.0 - exp(-(m - 0.8) * 3.0))) / m;","  }","  gl_FragColor = vec4(max(sky, 0.0), 1.0);","}"].join(`
`),Ct=[2,3,5],wa=[0,6,8],ys=3,Ms={id:"g05-odyssey-cracks",name:"g05 odyssey-cracks",hiRes:!0,params:[{id:"dust",label:"dust amount",min:0,max:2,step:.05,default:1},{id:"speed",label:"flight speed",min:.2,max:2.5,step:.05,default:1},{id:"chaos",label:"mutation chaos",min:0,max:2,step:.05,default:1},{id:"cracks",label:"crack intensity",min:0,max:2,step:.05,default:1}],create:()=>{let t=.5,e=0,o=0,r=null,a=Math.floor(Math.random()*4),s=a,i=0,b=Ct[0],p=0,x=0,v=0,u=1,w=1,g=1,k=0,d=99,_=null,f=0,n=999,T=0,C=0,M=0,c=0,l=-99,m=0,P=0,h=0,y=0,S=0,I=0;return ue({fragment:ks,feedback:!0,uniforms:A=>{var pe,fe,ce,ge,ee;const E=P>0?Math.min(.1,Math.max(0,A.time-P)):.016666666666666666;P=A.time;const R=X(A.bands),D=A.beat,H=(pe=A.params.chaos)!=null?pe:1,q=Math.min(1,Math.max(0,(A.bands.low-.2)/.5)),O=1-Math.exp(-E/.35);C+=(A.trend.excitement*q-C)*O,M+=(A.trend.excitement*(1-q)-M)*O;const W=Math.min(1,R*1.4),F=Math.max(C,.7*W);C>.45&&c<=.45&&A.time-l>8&&(l=A.time,x=0,p=0,a=(a+2)%4,w=1.2,k=Math.min(1.4,1.2*H),I=Math.min(1,.8+.4*H)),c=C,R<.15?m+=E:m=0,m>2.5&&x!==2&&(x=2,p=0,k=Math.max(k,.25*H));const z=D?(fe=D.ladderBarIndex)!=null?fe:D.barIndex:null;if(D&&z!==null){if(_!==null&&z!==_){d=0;const de=(z%4+4)%4===0,Z=(z%16+16)%16===0;de&&(a=(a+1)%4,i=(i+1)%Ct.length,k=Math.max(k,.6*H)),Z&&(F>.5?(x=0,p=1+Math.floor(Math.random()*2)):(x=(x+1)%ys,p=(p+1)%wa.length),u*=-1,w=1+(Math.random()-.35)*.6*H,k=Math.min(1.4,1*H))}_=z}else _=null;const L=1-Math.exp(-E/.9),N=1-Math.exp(-E/.4);s+=(a-s)*L,b+=(Ct[i]-b)*N,v+=(x-v)*L,g+=(w-g)*N,k=Math.max(0,k-E*1.4),d+=E,f=Math.min(1.4,f*Math.exp(-E/2.5)+A.impulse.low*.28),n+=E,A.impulse.low>.35&&n>.12&&(n=0,T=Math.min(1,A.impulse.low*1.2));const G=(ce=A.params.cracks)!=null?ce:1;if(A.impulse.low>.3){h=Math.min(1.3,A.impulse.low*1.2*G);const de=A.time*.9+A.impulse.low*3,Z=.28+.22*Math.sin(A.time*.53);y=Math.cos(de)*Z,S=Math.sin(de*1.31)*Z*.7}else h*=Math.exp(-E/.7);I=Math.max(0,I-E*.12);const U=(ge=A.params.speed)!=null?ge:1,B=Math.max(0,1-Math.abs(v)),K=Math.max(0,1-Math.abs(v-1)),ae=Math.max(0,1-Math.abs(v-2)),J=D&&z!==null?((z%4+4)%4+D.barPhase)/4:0,te=1+(.08+.7*F+3.6*A.impulse.low*(.5+.5*F))*(.85+.3*J)*U*E,V=1-(.04+.25*R)*U*E+2.2*A.impulse.low*U*E*.5,le=1+.5*A.impulse.low*U*E,j=(.05+.5*A.bands.mid+.25*W)*U*E,$=J,oe=D&&z!==null?((z%16+16)%16+D.barPhase)/16:0,he=D?D.barPhase:1;t+=(A.centroid-t)*(1-Math.exp(-E/1));let se=null,ie=-1;for(const de of A.decks)de.level>ie&&(ie=de.level,se=de.trackId);return se!==null&&se!==r&&(r=se,o=ws(se)),e+=(o-e)*(1-Math.exp(-E/2)),{u_hueRot:((e+(t-.5)*.8)%1+1)%1,u_time:A.time,u_low:A.bands.low,u_mid:A.bands.mid,u_high:A.bands.high,u_kick:A.impulse.low,u_snare:A.impulse.mid,u_drop:C,u_buildup:M,u_sustain:W,u_centroid:A.centroid,u_decay:Math.min(.998,.992-.008*R-.008*M),u_seed:Math.floor(A.time*20),u_spawn:Math.min(1,1.15*A.impulse.high+.2*A.bands.high)*(.4+.6*Math.max(C,W))/(1+1.8*M)/(1+2.2*A.impulse.low),u_spawnSnare:Math.min(1,.95*A.impulse.mid)*(.5+.5*Math.max(C,W))/(1+.8*M)/(1+2.2*A.impulse.low),u_zoom:B*te+K*V+ae*le,u_rotStep:u*j*(1+2.2*ae),u_charge:f,u_rippleAge:n,u_rippleAmp:T,u_palette:s,u_arms:b,u_fold:wa[p],u_horizonScale:g,u_flash:k,u_phrase:$,u_section:oe,u_barWave:d,u_beatPump:D?Math.pow(1-D.phase,2):0,u_dust:(ee=A.params.dust)!=null?ee:1,u_crackHeal:he,u_crackAmt:h,u_crackCenter:[y,S],u_crackDrop:I}}})}},Tt=24,Rs=`
precision highp float;
uniform sampler2D u_prev;
uniform vec2 u_res;
uniform float u_time;
uniform float u_spectrum[24];
uniform float u_low;
uniform float u_mid;
uniform float u_high;
uniform float u_kick;
uniform float u_drop;
uniform float u_buildup;
uniform float u_sustain;
uniform float u_centroid;
uniform float u_flatness;
uniform float u_orbit;
uniform float u_barPhase;
uniform float u_decay;
uniform float u_glow;
uniform float u_lines;
uniform float u_palette;
uniform float u_seed;

const float TAU = 6.28318530718;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

// Wide-phase-span palette so the field's color is free to travel while
// shape carries band identity (chroma-preserving downstream).
vec3 palette(float t) {
  vec3 a; vec3 b; vec3 cf; vec3 d;
  if (u_palette < 0.5) {
    a = vec3(0.20, 0.08, 0.35); b = vec3(0.65, 0.45, 0.55);
    cf = vec3(1.0, 1.1, 0.9); d = vec3(0.0, 0.25, 0.55);
  } else if (u_palette < 1.5) {
    a = vec3(0.05, 0.25, 0.30); b = vec3(0.45, 0.65, 0.55);
    cf = vec3(1.0, 0.9, 1.1); d = vec3(0.15, 0.35, 0.7);
  } else {
    a = vec3(0.35, 0.10, 0.10); b = vec3(0.6, 0.4, 0.3);
    cf = vec3(0.9, 1.0, 1.15); d = vec3(0.0, 0.15, 0.35);
  }
  return a + b * cos(TAU * (cf * t + d));
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  float aspect = u_res.x / u_res.y;
  vec2 c = (uv - 0.5) * vec2(aspect, 1.0);
  float r = length(c);
  vec2 dir = r > 1e-4 ? c / r : vec2(0.0);

  // ---- Feedback advection for glow persistence. Kicks compress the field
  // inward (solid pull toward core); drops fling it outward into bloom;
  // buildups tighten orbits inward. One radial push, chroma-preserving.
  float outward = (0.030 * u_drop + 0.008 * u_sustain) * exp(-r * 0.9);
  float inward = (0.020 * u_kick + 0.014 * u_buildup) * exp(-r * 0.6);
  vec2 src = (c - dir * (outward - inward)) / vec2(aspect, 1.0) + 0.5;
  vec3 medium = texture2D(u_prev, src).rgb * u_decay;

  // ---- Orbit radius: buildups pull the constellation in (tighter orbits),
  // drops push it out (bloom explosion). Kick adds a solid inward squeeze.
  float ringR = 0.34 * (1.0 + 0.55 * u_drop - 0.30 * u_buildup - 0.22 * u_kick);
  ringR = max(0.05, ringR);

  // ---- Summed potential of 24 orbiting charges. Each bin sits at an angle
  // fanned around the circle, spun by the meter-locked orbit phase; low bins
  // orbit the inner ring, high bins the outer, so band identity is spatial.
  float field = 0.0;      // additive glow potential
  float potential = 0.0;  // scalar potential for equipotential contours
  vec3 tint = vec3(0.0);
  for (int i = 0; i < 24; i++) {
    float fi = float(i);
    float q = u_spectrum[i];
    // Radius spreads by band index; charge pushes it slightly outward.
    float rad = ringR * (0.45 + 0.75 * (fi / 23.0)) * (1.0 + 0.18 * q);
    // Meter-locked orbit: whole-bar period. Alternate bins counter-rotate
    // for a woven constellation; charge speeds a bin's own precession.
    float spin = (mod(fi, 2.0) < 0.5 ? 1.0 : -1.0);
    float ang = (fi / 24.0) * TAU + spin * u_orbit + fi * 0.13 + q * 0.4;
    vec2 pos = vec2(cos(ang), sin(ang)) * rad;
    vec2 delta = c - pos;
    float d2 = dot(delta, delta);
    // Gaussian charge; buildup sharpens it (tenser, brighter cores).
    float sigma = 0.0016 + 0.0060 * (1.0 - 0.5 * u_buildup);
    float g = exp(-d2 / sigma);
    float mag = q * q * (0.6 + 1.4 * q);
    field += g * mag;
    // Soft 1/(r^2) potential well for the contour lines.
    potential += mag * 0.0009 / (d2 + 0.0009);
    // Color travels with band index + centroid; each charge tints locally.
    tint += palette(fi / 24.0 * 0.9 + u_centroid * 0.35 + u_time * 0.02)
      * g * mag;
  }

  // ---- Additive glow from the summed field. Drop ramps the whole field;
  // buildup saturates by pushing the palette color harder.
  vec3 glowCol = (field > 1e-4 ? tint / max(field, 1e-4) : palette(u_centroid));
  float sat = 1.0 + 0.6 * u_buildup;
  glowCol = mix(vec3(dot(glowCol, vec3(0.33))), glowCol, sat);
  medium += glowCol * field * u_glow * (1.0 + 1.8 * u_drop + 0.5 * u_sustain);

  // ---- Faint equipotential lines: thin bright bands where the summed
  // potential crosses integer levels — the field's "magnetic contour".
  float levels = 7.0;
  float band = fract(potential * levels);
  float contour = smoothstep(0.5, 0.0, abs(band - 0.5) * 2.0);
  contour = pow(contour, 6.0);
  medium += palette(u_centroid * 0.5 + 0.2) * contour * u_lines
    * (0.06 + 0.20 * u_mid) * smoothstep(0.02, 0.5, potential);

  // ---- Core well: a dim charged heart, whitening as a drop ignites.
  float heart = exp(-r * r * 90.0);
  medium += mix(vec3(0.25, 0.10, 0.30), vec3(1.0, 0.96, 0.9), 0.8 * u_drop)
    * heart * (0.25 + 0.8 * u_low + 2.4 * u_drop + 0.9 * u_kick);

  // ---- Flatness grain shimmer: noisy/percussive material dusts the field
  // with fine sparkle (mid/high-only, never a kick effect).
  float grain = hash(gl_FragCoord.xy * 1.7 + u_seed);
  float sparkle = step(0.985 - 0.03 * u_flatness, grain);
  medium += palette(0.6 + u_high * 0.3) * sparkle * u_flatness
    * (0.15 + 0.9 * u_high) * smoothstep(0.05, 0.4, r);

  // ---- Chroma-preserving soft knee (scale all channels by one factor so
  // hues hold; never per-channel clamp). Drop lifts the ceiling.
  medium *= 0.9 + 0.5 * max(u_drop, u_sustain) - 0.05 * u_buildup;
  float m = max(medium.r, max(medium.g, medium.b));
  if (m > 0.82) {
    medium *= (0.82 + 0.18 * (1.0 - exp(-(m - 0.82) * 3.0))) / m;
  }
  gl_FragColor = vec4(max(medium, 0.0), 1.0);
}
`,Ss=[{id:"glow",label:"field glow",min:0,max:2,step:.05,default:1},{id:"lines",label:"equipotential lines",min:0,max:2,step:.05,default:1},{id:"palette",label:"palette 0-2 (violet/teal/ember)",min:0,max:2,step:1,default:0},{id:"persistence",label:"glow persistence",min:.5,max:2,step:.05,default:1.2},{id:"orbitBars",label:"orbit period (bars)",min:1,max:8,step:1,default:2}],As=Math.floor(Tt/4),Cs={id:"g03-charge-bloom",name:"g03 charge-bloom",hiRes:!0,params:Ss,create:()=>{const t=new Float32Array(Tt);let e=0,o=0,r=0,a=0,s=0;return ue({fragment:Rs,feedback:!0,uniforms:i=>{var d,_,f,n,T,C;const b=a>0?Math.min(.1,Math.max(0,i.time-a)):.016666666666666666;a=i.time;const p=X(i.bands),x=Math.min(1,Math.max(0,(i.bands.low-.2)/.5)),v=1-Math.exp(-b/.35);e+=(i.trend.excitement*x-e)*v,o+=(i.trend.excitement*(1-x)-o)*v;let u=0;for(const M of i.decks){if(!M.playing||M.level<=.02)continue;const c=Math.max(0,(.5-M.eq.low)/.5);u=Math.max(u,c*Math.min(1,M.level*1.5))}for(let M=0;M<Tt;M++){const c=(d=i.spectrum[M])!=null?d:0,l=M<As?1-u:1;t[M]=c*l}const w=Math.max(1,Math.round((_=i.params.orbitBars)!=null?_:2));if(i.beat){let M=i.beat.barPhase-s;M<-.5&&(M+=1),M<0&&(M=0),s=i.beat.barPhase,r+=M/w*2*Math.PI}else r+=b*(.25+.4*i.bands.mid);const g=(f=i.params.persistence)!=null?f:1.2,k=.985-.008*p;return{u_time:i.time,u_spectrum:t,u_low:i.bands.low,u_mid:i.bands.mid,u_high:i.bands.high,u_kick:i.impulse.low,u_drop:e,u_buildup:o,u_sustain:Math.min(1,p*1.4),u_centroid:i.centroid,u_flatness:i.flatness,u_orbit:r,u_barPhase:i.beat?i.beat.barPhase:0,u_decay:Math.min(.996,1-(1-k)/g),u_glow:(n=i.params.glow)!=null?n:1,u_lines:(T=i.params.lines)!=null?T:1,u_palette:(C=i.params.palette)!=null?C:0,u_seed:Math.floor(i.time*24)%1e3}}})}},Ts=t=>`vec3(${t[0].toFixed(3)}, ${t[1].toFixed(3)}, ${t[2].toFixed(3)})`,Se=5,Is=`
precision highp float;
uniform sampler2D u_prev;
uniform vec2 u_res;
uniform float u_time;
uniform float u_low;
uniform float u_mid;
uniform float u_midSlow;    // motion-grade mid: gas convection rate (erratic-motion law)
uniform float u_high;
uniform float u_kick;
uniform float u_snare;
uniform float u_centroid;   // shimmer hue bias
uniform float u_spread;     // gas breadth
uniform float u_drop;       // bass-weighted smoothed drop
uniform float u_sustain;    // sustained loudness (ride the plateau)
uniform float u_buildup;    // excitement without bass (tense compression)
uniform float u_phrase;     // 0..1 ramp within the current phrase (enrich)
uniform float u_regime;     // palette regime, advances on supernova
uniform float u_regimeMix;  // 0..1 crossfade between old and new regime
uniform float u_nova;       // supernova shell strength (decays)
uniform float u_novaAge;    // seconds since detonation (front radius)
uniform vec2 u_novaPos;     // detonation center (aspect-space)
uniform float u_seed;
uniform float u_density;    // param: gas density
uniform float u_filaments;  // param: filament gain
uniform float u_drift;      // param: drift speed
uniform float u_glow;       // param: emission memory (feedback gain)
// Live protostar cores: xy = position (aspect-space), z = age/ignition,
// w = illumination-front launch time (seconds since kick that lit it).
uniform vec3 u_cores[${Se}];      // xy pos, z ignition 0..1
uniform vec3 u_coreFront[${Se}];  // x frontAge, y frontAmp, z hue

const vec3 LOW = ${Ts(re[0])};

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

// Value noise with per-axis seed mixing (no diagonal moire).
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

// iq-style FBM: 5 octaves, gas volume density.
float fbm(vec2 p) {
  float v = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 5; i++) {
    v += amp * noise(p);
    p = p * 2.02 + vec2(19.1, 7.3);
    amp *= 0.5;
  }
  return v;
}

// nimitz triangle noise (for filament ridges): |fract| tent.
float tri(float x) { return abs(fract(x) - 0.5); }

// Two saturated palette regimes; the supernova crossfades between them.
// Each regime is an iq cosine palette with wide phase span so gas TRAVELS
// in color (else it reads monochrome, per taste calibration).
vec3 palRegime(float t, float r) {
  // r selects one of a small family of palettes cyclically.
  float k = mod(r, 4.0);
  vec3 a, b, c, d;
  if (k < 1.0) {          // emerald / cyan emission
    a = vec3(0.10, 0.28, 0.30); b = vec3(0.30, 0.45, 0.42);
    c = vec3(0.90, 1.00, 0.85); d = vec3(0.10, 0.30, 0.55);
  } else if (k < 2.0) {   // magenta / violet H-alpha
    a = vec3(0.35, 0.12, 0.38); b = vec3(0.45, 0.20, 0.40);
    c = vec3(1.00, 0.85, 0.70); d = vec3(0.00, 0.25, 0.55);
  } else if (k < 3.0) {   // gold / amber sulfur
    a = vec3(0.42, 0.30, 0.14); b = vec3(0.48, 0.40, 0.28);
    c = vec3(1.00, 0.92, 0.65); d = vec3(0.05, 0.18, 0.40);
  } else {                // sapphire / teal oxygen
    a = vec3(0.12, 0.22, 0.42); b = vec3(0.24, 0.38, 0.48);
    c = vec3(0.80, 1.00, 0.95); d = vec3(0.15, 0.35, 0.60);
  }
  return a + b * cos(6.28318 * (c * t + d));
}

vec3 palette(float t) {
  // Crossfade old -> new regime for a chromatic supernova recolor.
  vec3 oldC = palRegime(t, u_regime - 1.0);
  vec3 newC = palRegime(t, u_regime);
  return mix(oldC, newC, clamp(u_regimeMix, 0.0, 1.0));
}

// Iridescent shimmer: a thin-film spectrum from a phase; carried by highs.
vec3 iridescent(float phase) {
  return 0.55 + 0.45 * cos(6.28318 * (phase + vec3(0.0, 0.33, 0.66)));
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  float aspect = u_res.x / u_res.y;
  // Off-axis composition: origin biased left/low so the pillar field rises
  // from a corner rather than a centered mandala.
  vec2 c = (uv - vec2(0.32, 0.38)) * vec2(aspect, 1.0);
  float t = u_time * u_drift;
  vec2 px = 1.0 / u_res;

  // ---- Feedback: SLOW emission memory only. Sample the same pixel (no
  // advection warp), unsharp against a 4-tap blur so ignitions leave a
  // fading glow trail without smearing into a tunnel. Chroma-preserving.
  vec3 prev = texture2D(u_prev, uv).rgb;
  vec3 blur = (texture2D(u_prev, uv + vec2(px.x, 0.0)).rgb
    + texture2D(u_prev, uv - vec2(px.x, 0.0)).rgb
    + texture2D(u_prev, uv + vec2(0.0, px.y)).rgb
    + texture2D(u_prev, uv - vec2(0.0, px.y)).rgb) * 0.25;
  vec3 memory = max(vec3(0.0), prev * 1.06 - blur * 0.06);
  float memGain = clamp(0.60 + 0.30 * u_glow, 0.0, 0.93);
  vec3 col = memory * memGain;

  // ---- GAS VOLUME: two pseudo-raymarch FBM layers with domain-warp churn
  // driven by mids (convection). Buildup COMPRESSES the gas (tighter,
  // higher contrast). Spread widens the sampled palette span.
  float compress = 1.0 + 0.7 * u_buildup + 0.25 * u_phrase;
  vec2 warp = vec2(
    fbm(c * 1.6 + vec2(0.0, t * 0.18)),
    fbm(c * 1.6 + vec2(5.2, 3.1) - t * 0.14)
  ) - 0.5;
  // motion: slow bands (erratic-motion law) — gas convection rate
  float convection = (0.25 + 0.9 * u_midSlow + 0.4 * u_sustain);
  vec2 gp = c * compress + warp * convection * 0.55;

  // Layer A: broad shells of gas.
  float shell = fbm(gp * 1.5 + vec2(t * 0.05, -t * 0.03));
  // Layer B: finer pillars (stretched vertically -> pillar structure).
  float pillar = fbm(vec2(gp.x * 2.4, gp.y * 1.1) + vec2(-t * 0.04, t * 0.02));
  float gas = pow(clamp(shell * 0.6 + pillar * 0.7, 0.0, 1.4), 1.7);
  gas *= (0.5 + 1.1 * u_density);

  // Gas color travels: wide phase span from position + spread + centroid.
  float palT = shell * (1.0 + 0.7 * u_spread) + gp.y * 0.22 + gp.x * 0.08
    + t * 0.02 + u_centroid * 0.35;
  vec3 gasColor = palette(palT);
  // Dark-sky floor: gas reads against near-black, brightens with energy.
  float gasGain = 0.10 + 0.9 * u_mid + 0.5 * u_sustain + 0.35 * u_drop;
  col += gasColor * gas * gasGain;

  // ---- IRIDESCENT RIM SHIMMER (HIGH): the gradient magnitude of the gas
  // gives cloud edges; a thin-film spectrum races along them, phase driven
  // by highs + centroid. This carries high-frequency response (no dust).
  float gx = fbm(gp * 1.5 + vec2(px.x * 40.0, 0.0)) - shell;
  float gy = fbm(gp * 1.5 + vec2(0.0, px.y * 40.0)) - shell;
  float edge = clamp(length(vec2(gx, gy)) * 6.0, 0.0, 1.0);
  float shimPhase = shell * 2.0 + u_centroid * 0.8 + t * 0.4
    + u_high * 3.0;
  vec3 rim = iridescent(shimPhase);
  float shimmer = edge * (0.4 + 0.6 * sin(t * 9.0 + shell * 30.0));
  col += rim * shimmer * (0.05 + 1.6 * u_high) * (0.4 + 0.6 * gas);

  // ---- MAGNETIC FILAMENTS (HIGH): nimitz layered sine ridges + triangle
  // noise — thin glowing threads that ripple. Diagonal across the field.
  float fil = 0.0;
  float famp = 1.0;
  vec2 fp = c * 1.0;
  for (int i = 0; i < 3; i++) {
    // ridged sine with triangle-noise perturbation.
    float ridge = fp.y * 3.0 + sin(fp.x * 4.0 + t * 1.3) * 1.2
      + tri(fp.x * 2.0 - t * 0.5) * 3.0;
    float thread = 1.0 - smoothstep(0.0, 0.10, abs(fract(ridge) - 0.5));
    fil += thread * famp;
    famp *= 0.55;
    fp = fp * 1.9 + vec2(1.7, -0.9);
    fp = mat2(0.80, -0.60, 0.60, 0.80) * fp;
  }
  fil = pow(clamp(fil, 0.0, 1.0), 1.5);
  float filRipple = 0.6 + 0.4 * sin(t * 12.0 + c.x * 20.0);
  vec3 filColor = mix(iridescent(u_centroid + t * 0.15), palette(0.6 + t * 0.05), 0.45);
  col += filColor * fil * filRipple * u_filaments * (0.08 + 1.7 * u_high)
    * (0.5 + 0.5 * gas);

  // ---- PROTOSTAR CORES (LOW/KICK): solid compact ignitions inside the
  // gas. Each core: a hot core + a bloom, brightening with its ignition
  // envelope. On a kick it launches a spherical ILLUMINATION FRONT (voyage
  // ripple, 3D guise) that LIGHTS the gas it passes through.
  for (int i = 0; i < ${Se}; i++) {
    vec3 core = u_cores[i];
    vec3 fr = u_coreFront[i];
    vec2 d = c - core.xy;
    float dist = length(d);
    float ignite = core.z;
    // Solid core: tight gaussian, white-hot center, colored bloom.
    float hot = exp(-dist * dist * (900.0 - 500.0 * ignite));
    float bloom = exp(-dist * (10.0 - 4.0 * ignite));
    vec3 coreHue = mix(LOW, vec3(1.0, 0.95, 0.85), 0.4 + 0.6 * ignite);
    coreHue = mix(coreHue, palette(fr.z), 0.35);
    col += coreHue * hot * (0.6 + 1.6 * ignite);
    col += mix(coreHue, palette(fr.z), 0.5) * bloom * (0.15 + 0.7 * ignite);
    // Traveling illumination front: a spherical shell expanding from the
    // core, lighting gas it passes. exp decay in age + amplitude.
    float frontR = 0.02 + fr.x * 0.85;
    float front = exp(-pow((dist - frontR) * 8.0, 2.0)) * exp(-fr.x * 2.2) * fr.y;
    col += mix(coreHue, gasColor, 0.6) * front * (0.5 + 2.0 * gas) * 1.3;
  }

  // ---- SUPERNOVA (section boundary): a shell shockwave from u_novaPos.
  // Its job is CHROMATIC (the palette crossfade above), plus a physical
  // shell — a bright ring lighting the gas, rate-limited so it is a sweep
  // not a full-field flash.
  if (u_nova > 0.001) {
    vec2 nd = c - u_novaPos;
    float ndist = length(nd);
    float shellR = 0.03 + u_novaAge * 1.4;
    float shellRing = exp(-pow((ndist - shellR) * 6.0, 2.0)) * u_nova;
    // The freshly-recolored palette rides the shell.
    vec3 novaHue = palette(0.2 + ndist * 0.4 + t * 0.05);
    col += novaHue * shellRing * (0.8 + 1.5 * gas);
    // Faint enrichment: the shell leaves brightened gas behind it.
    float wake = smoothstep(shellR, shellR - 0.4, ndist) * u_nova * 0.15;
    col += novaHue * gas * wake;
  }

  // ---- Snare texture: a soft convection lift (NOT particles) — a brief
  // brightening of the gas convection, mid-transient owned.
  if (u_snare > 0.03) {
    col += gasColor * gas * u_snare * 0.25;
  }

  // Buildup tension: gas contrast up, overall slightly dimmed (tense-but-
  // alive, never eerily still). Drop/sustain bloom.
  col *= 0.72 + 0.5 * max(u_drop, u_sustain) - 0.06 * u_buildup;

  // Palette grade: whole frame leans to the regime hue so recolors read.
  vec3 grade = palette(0.35 + u_centroid * 0.2);
  col = mix(col, col * (0.45 + grade * 1.5), 0.20);

  // Photosensitivity + chroma-preserving soft knee (never per-channel).
  float m = max(col.r, max(col.g, col.b));
  if (m > 0.85) {
    col *= (0.85 + 0.15 * (1.0 - exp(-(m - 0.85) * 3.0))) / m;
  }
  gl_FragColor = vec4(max(col, 0.0), 1.0);
}
`,Ps={id:"g06-nursery",name:"g06 nursery",hiRes:!0,params:[{id:"density",label:"gas density",min:0,max:2,step:.05,default:1},{id:"filaments",label:"filament gain",min:0,max:2,step:.05,default:1},{id:"drift",label:"drift speed",min:.2,max:2.5,step:.05,default:1},{id:"glow",label:"emission memory",min:0,max:1.5,step:.05,default:.9}],create:()=>{let t=0,e=0,o=0,r=0,a=0,s=1,i=0,b=999,p=[0,0],x=-1,v=0,u=-1;const w=f=>{const n=Math.sin(f*127.1+311.7)*43758.5453;return n-Math.floor(n)},g=(f,n)=>({x:(w(f*3.7+n*11.3)-.4)*1.4,y:(w(f*5.1+n*7.9)-.35)*1.1,ignition:0,frontAge:999,frontAmp:0,hue:w(f*2.3+n*4.1)});let k=0;const d=[];for(let f=0;f<Se;f++)d.push(g(f,0));let _=0;return ue({fragment:Is,feedback:!0,uniforms:f=>{var F,z,L,N,G,U;const n=f.bands,T=f.impulse,C=f.trend,M=f.beat,c=t>0?Math.min(.1,Math.max(0,f.time-t)):1/60;t=f.time;const l=X(n),m=(F=f.bandsSlow)!=null?F:n,P=Math.min(1,Math.max(0,(n.low-.2)/.5)),h=1-Math.exp(-c/.35);e+=(C.excitement*P-e)*h,o+=(C.excitement*(1-P)-o)*h;const y=Math.min(1,l*1.4);r+=(y-r)*h;const S=M?(z=M.ladderBarIndex)!=null?z:M.barIndex:0,I=Math.floor(S/16),A=(S%4+4)%4;A!==x&&(A===0&&(v=S),x=A);const E=M?M.barPhase:0,R=Math.min(1,(S-v+E)/4);I!==u&&(u>=0&&(a+=1,s=0,i=1,b=0,p=[d[_].x,d[_].y],k+=1,d[_]=g(_,k),_=(_+1)%Se),u=I),s=Math.min(1,s+c/1.2),b+=c,i=Math.max(0,i-c/1.6);const D=T.low,H=Math.min(1,n.low*.9+e*.6),q=D>.32;for(let B=0;B<Se;B++){const K=d[B],ae=K.ignition<H?1-Math.exp(-c/.12):1-Math.exp(-c/.7);K.ignition+=(H-K.ignition)*ae,K.frontAge+=c,q&&K.frontAge>.14&&(e>.25||w(B*9.1+Math.floor(f.time))<.45+.5*D)&&(K.frontAge=0,K.frontAmp=Math.min(1,D*1.3))}const O=new Float32Array(Se*3),W=new Float32Array(Se*3);for(let B=0;B<Se;B++){const K=d[B];O[B*3+0]=K.x,O[B*3+1]=K.y,O[B*3+2]=K.ignition,W[B*3+0]=K.frontAge,W[B*3+1]=K.frontAmp,W[B*3+2]=K.hue}return{u_time:f.time,u_low:n.low,u_mid:n.mid,u_midSlow:m.mid,u_high:n.high,u_kick:T.low,u_snare:T.mid,u_centroid:f.centroid,u_spread:f.spread,u_drop:e,u_sustain:r,u_buildup:o,u_phrase:R,u_regime:a,u_regimeMix:s,u_nova:i,u_novaAge:b,u_novaPos:p,u_seed:Math.floor(f.time*20),u_density:(L=f.params.density)!=null?L:1,u_filaments:(N=f.params.filaments)!=null?N:1,u_drift:(G=f.params.drift)!=null?G:1,u_glow:(U=f.params.glow)!=null?U:.9,u_cores:O,u_coreFront:W}}})}},Ds={fast:0,med:0,slow:0,peak:0,riser:0,drop:0,sustained:0,breakdown:0,primed:0,sinceDropS:1/0},ze=(t,e)=>1-Math.exp(-Math.max(0,t)/e);function Es(t){return Math.min(1,t.low*.55+t.mid*.3+t.high*.15)}function Fs(t,e,o){const r=Es(e),a=t.fast+(r-t.fast)*ze(o,.25),s=t.med+(a-t.med)*ze(o,2),i=t.slow+(a-t.slow)*ze(o,10),b=Math.max(a,t.peak*Math.exp(-o/12)),p=Math.max(0,a-s),x=Math.min(1,Math.max(0,(e.mid+e.high)*.75-e.low*.6+.25)),v=Math.min(1,p*10)*x;let u=t.riser+(v-t.riser)*ze(o,v>t.riser?1.2:.8);u=Math.min(1,Math.max(0,u));const w=Math.max(u,t.primed*Math.exp(-o/4)),g=e.low>.45&&a>i*1.15+.05;let k=t.drop*Math.exp(-o/3),d=t.sinceDropS+o;g&&w>.35&&t.sinceDropS>4&&(k=Math.max(k,Math.min(1,w+.3)),d=0,u=0);const _=Math.min(1,Math.max(0,(a-i*1.05)/.25))*Math.min(1,a/.35),f=t.sustained+(_-t.sustained)*ze(o,.6),n=Math.min(1,Math.max(0,(i*.7-a)/.2))*Math.min(1,b/.3),T=t.breakdown+(n-t.breakdown)*ze(o,1);return{fast:a,med:s,slow:i,peak:b,riser:u,drop:k,sustained:f,breakdown:T,primed:w,sinceDropS:d}}function Hs(t){return{buildup:t.riser,dropTransition:t.drop,sustained:t.sustained,breakdown:t.breakdown,dropAgeS:t.sinceDropS}}const qs={levels:{},dominantId:null};function zs(t,e,o,r={}){var w,g,k,d,_;const a=(w=r.tauSeconds)!=null?w:.7,s=(g=r.takeoverRatio)!=null?g:1.2,i=Math.max(0,Math.min(1,o)),b=1-Math.exp(-i/a),p={},x=new Set;for(const f of e){const n=(k=t.levels[f.id])!=null?k:0;p[f.id]=n+(f.level-n)*b,f.eligible&&x.add(f.id)}const v=()=>{var T;let f=null,n=-1/0;for(const C of x){const M=(T=p[C])!=null?T:0;M>n&&(n=M,f=C)}return f};let u=t.dominantId;if(u===null||!x.has(u))u=v();else{const f=(d=p[u])!=null?d:0,n=v();n!==null&&n!==u&&((_=p[n])!=null?_:0)>f*s+1e-6&&(u=n)}return{levels:p,dominantId:u}}const ka=[20,60,150,400,1e3,2500,6e3,12e3,2e4],It=48e3,rt=2048,Ue=rt/2,Ws=-6,Pt=new Int8Array(Ue).fill(-1),Dt=new Array(8).fill(0);for(let t=1;t<Ue;t++){const e=t*It/rt;for(let o=0;o<8;o++)if(e>=ka[o]&&e<ka[o+1]){Pt[t]=o,Dt[o]++;break}}function Os(t,e=new Float32Array(Ue),o=Ws){var a;const r=new Array(8);for(let s=0;s<8;s++){const i=(a=t[s])!=null?a:0;r[s]=i>1e-6&&Dt[s]>0?20*Math.log10(i)-10*Math.log10(Dt[s])+o:-1/0}for(let s=0;s<Ue;s++)e[s]=Pt[s]<0?-1/0:r[Pt[s]];return e}function Ls(t){var o;const e=new Array(8).fill(0);for(const r of t)if(r.playing)for(let a=0;a<8;a++){const s=((o=r.bands[a])!=null?o:0)*r.gain;e[a]+=s*s}return e.map(Math.sqrt)}function Bs(t){if(!t.playing)return 0;let e=0;for(const r of t.bands)e+=r*r;const o=10*Math.log10(Math.max(1e-12,e))+20*Math.log10(Math.max(1e-6,t.gain));return Math.min(1,Math.max(0,(o+36)/30))}function ya(t){return!t.bpm||t.bpm<=0?null:{beats:(t.pos-t.anchor)*t.bpm/60}}const Ma=t=>t-Math.floor(t),st=(t,e)=>(t%e+e)%e;function Ns(){const t=Pr(40,16e3,we),e=new Float32Array(Ue);let o=tt,r=tt,a=new Array(we).fill(0),s=Gr,i=Vr,b=Ds,p=qs,x=0;return{frameAt(v,u,w){var C;x+=u,Os(Ls(v.decks),e);const g=Dr(e,It,rt),k=ma(e,It,rt,t);o=Hr(o,g,u),r=Wr(r,g,u),a=Fr(a,k,u),s=$r(s,g,u),i=jr(i,X(g),u),b=Fs(b,g,u);const d=v.decks.map(M=>{const c=M.playing?ya(M):null;return{channel:M.ch,level:Bs(M),playing:M.playing,trackId:M.trackId,beatPhase:c?Ma(c.beats):null,barPhase:c?st(c.beats,4)/4:null,beatInBar:c?Math.floor(st(c.beats,4)):null,beatsPerBar:4,bpm:M.bpm?M.bpm*M.rate:null,eq:{low:M.eq[0],mid:M.eq[1],high:M.eq[2]},fader:M.fader}});p=zs(p,d.map(M=>({id:M.channel,level:M.level,eligible:M.playing&&M.level>.02})),u);const _=(C=p.dominantId)!=null?C:null,f=v.decks.find(M=>M.ch===_),n=f?ya(f):null,T=n&&f?{phase:Ma(n.beats),barPhase:st(n.beats,4)/4,beatInBar:Math.floor(st(n.beats,4)),beatsPerBar:4,barIndex:Math.floor(n.beats/4),ladderBarIndex:n.beats>=0?Math.floor(n.beats/4):null,bpm:f.bpm?f.bpm*f.rate:null}:null;return{bands:o,bandsSlow:r,spectrum:a,wave:null,beat:T,impulse:s.impulse,trend:i,regime:Hs(b),centroid:Yr(a),spread:Xr(a),flatness:Jr(a),decks:d,dominantChannel:_,params:w,time:x,dt:u}}}}const Gs={voyage:Fa,tunnel:za,aurora:Oa,nova:Ba,plasma:Ga,odyssey:Va,silk:Ya,strata:Qa,siphon:eo,orbit:io,pulse:ho,ladder:mo,"g02-voyage-prime":vo,"g05-materia-shards":ko,"g02-materia":Ro,"g03-materia-deep":To,"g07-materia-metric":qo,"g04-materia-arc":Lo,"g05-materia-mercury":$o,"g03-solar-crown":Vo,"g07-seasons-neon":Qo,"g07-voyage-hardcut":ir,"g05-voyage-deckmix":pr,"g04-tunnel-saga":vr,"g05-tunnel-deckmix":yr,"g02-mirror-ladder":os,"g07-crt":ls,"g01-warp-nebula":hs,"g06-orrery":gs,"g01-odyssey-drift":xs,"g05-odyssey-cracks":Ms,"g03-charge-bloom":Cs,"g06-nursery":Ps},it=Ie.map(([t])=>[t,Gs[t]]),ve=document.getElementById("viz"),$s=ve.getContext("2d",{alpha:!1}),Ra=document.getElementById("hud"),Us=Ns(),Ae={scale:.5,fps:30,debug:!1,gainDb:0,opacity:.7};let ke=null;function Sa(t){var a,s,i,b;const e=(a=it.find(([p])=>p===t))!=null?a:it[0];(i=ke==null?void 0:(s=ke.renderer).dispose)==null||i.call(s);const o=e[1],r={};for(const p of(b=o.params)!=null?b:[])r[p.id]=p.default;ke={id:e[0],preset:o,renderer:o.create(),params:r}}function Ks(){const t=window.devicePixelRatio||1,e=Math.max(1,Math.round(ve.clientWidth*t*Ae.scale)),o=Math.max(1,Math.round(ve.clientHeight*t*Ae.scale));(ve.width!==e||ve.height!==o)&&(ve.width=e,ve.height=o)}const Et=document.createElement("div");Et.style.cssText="position:fixed;inset:0;pointer-events:none;",document.body.appendChild(Et);const nt=[],Ke=[];let Ft=0;const Vs=0;function js(t){const e=performance.now(),o=window.devicePixelRatio||1;for(let r=0;r<t.length;r++){let a=nt[r];a||(a=document.createElement("div"),a.style.cssText="position:absolute;-webkit-backdrop-filter:blur(14px);backdrop-filter:blur(14px);",Et.appendChild(a),nt.push(a),Ke.push(""));const[s,i,b,p,x]=t[r],v=`${s},${i},${b},${p},${x}`;Ke[r]!==v&&(Ke[r]=v,a.style.left=`${s/o}px`,a.style.top=`${i/o}px`,a.style.width=`${b/o}px`,a.style.height=`${p/o}px`,a.style.borderRadius=`${x/o}px`,a.style.display="block")}for(let r=t.length;r<nt.length;r++)Ke[r]!==""&&(Ke[r]="",nt[r].style.display="none");Ft+=(performance.now()-e-Ft)*.05}const Aa={decks:[]};function Ys(){var t;try{const e=(t=window.ManadjVizHost)==null?void 0:t.frame();return e?JSON.parse(e):Aa}catch{return Aa}}let lt=0,ct=0,ut=0,Ht=0,qt=0;function Ca(t){var x,v,u,w;requestAnimationFrame(Ca);const e=1e3/Ae.fps;if(t-lt<e-2)return;const o=lt?Math.min(.1,(t-lt)/1e3):1/Ae.fps;if(lt=t,!ke)return;Ks();const r=performance.now(),a=Ys(),s=Math.pow(10,Ae.gainDb/20);if(s!==1)for(const g of a.decks)g.gain*=s;const i=performance.now(),b=Us.frameAt(a,o,ke.params);ke.renderer.render($s,ve.width,ve.height,b),js((x=a.panes)!=null?x:[]);const p=performance.now();if(ct+=(p-i-ct)*.05,ut+=(i-r-ut)*.05,Ht++,Ae.debug){const g=b.bands;Ra.textContent=`${ke.id} ${ve.width}x${ve.height} render ${ct.toFixed(1)}ms pull ${ut.toFixed(1)}ms
L ${g.low.toFixed(2)} M ${g.mid.toFixed(2)} H ${g.high.toFixed(2)} imp ${b.impulse.low.toFixed(2)} exc ${b.trend.excitement.toFixed(2)}
dom ${(v=b.dominantChannel)!=null?v:"-"} beat ${b.beat?`${b.beat.beatInBar+1}/${b.beat.barIndex} ${(u=b.beat.bpm)==null?void 0:u.toFixed(1)}`:"-"}`}if(t-qt>2e3){const g=Ht*1e3/(t-qt||1);qt=t,Ht=0,(w=window.ManadjVizHost)==null||w.stats(JSON.stringify({preset:ke.id,renderMs:ct,pullMs:ut,frostDownMs:Ft,frostDrawMs:Vs,fps:g,w:ve.width,h:ve.height}))}}window.manadjViz={presets:()=>JSON.stringify(it.map(([t,e])=>({id:t,name:e.name}))),setPreset:t=>{(ke==null?void 0:ke.id)!==t&&Sa(t)},setOptions:t=>{Object.assign(Ae,JSON.parse(t)),Ra.style.display=Ae.debug?"block":"none",ve.style.opacity=String(Ae.opacity)}},Sa(it[0][0]),requestAnimationFrame(Ca)})();
