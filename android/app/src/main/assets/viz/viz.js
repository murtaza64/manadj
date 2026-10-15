var so=Object.defineProperty;var no=(j,U,ke)=>U in j?so(j,U,{enumerable:!0,configurable:!0,writable:!0,value:ke}):j[U]=ke;var Y=(j,U,ke)=>no(j,typeof U!="symbol"?U+"":U,ke);(function(){"use strict";const j=[[1,.1,.1],[0,1,.25],[.2,.45,1]];function U(t){return Math.min(1,t.low*.5+t.mid*.3+t.high*.2)}function ke(t,e=0){return((250-t*210+e)%360+360)%360}const Rt=`
attribute vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }
`,At=`
precision mediump float;
uniform sampler2D u_prev;
uniform vec2 u_res;
void main() { gl_FragColor = texture2D(u_prev, gl_FragCoord.xy / u_res); }
`;function ot(t,e){const o=(n,d)=>{const f=t.createShader(n);return f?(t.shaderSource(f,d),t.compileShader(f),t.getShaderParameter(f,t.COMPILE_STATUS)?f:(console.warn("[glPreset] shader compile failed",t.getShaderInfoLog(f)),null)):null},s=o(t.VERTEX_SHADER,Rt),a=o(t.FRAGMENT_SHADER,e);if(!s||!a)return null;const r=t.createProgram();return r?(t.attachShader(r,s),t.attachShader(r,a),t.linkProgram(r),t.getProgramParameter(r,t.LINK_STATUS)?r:(console.warn("[glPreset] program link failed",t.getProgramInfoLog(r)),null)):null}function rt(t,e){const o=new Map,s=t.getProgramParameter(e,t.ACTIVE_UNIFORMS);for(let a=0;a<s;a++){const r=t.getActiveUniform(e,a);if(!r)continue;const n=r.name.replace(/\[0\]$/,""),d=t.getUniformLocation(e,r.name);d&&o.set(n,{location:d,type:r.type,size:r.size})}return o}class Tt{constructor(e){Y(this,"spec");Y(this,"canvas");Y(this,"pipeline",null);Y(this,"contextLost",!1);Y(this,"warned",new Set);this.spec=e,this.canvas=document.createElement("canvas"),this.canvas.addEventListener("webglcontextlost",o=>{o.preventDefault(),this.contextLost=!0}),this.canvas.addEventListener("webglcontextrestored",()=>{this.contextLost=!1,this.pipeline=null})}dispose(){var e,o;this.pipeline=null,(o=(e=this.canvas.getContext("webgl"))==null?void 0:e.getExtension("WEBGL_lose_context"))==null||o.loseContext()}setup(){const e=this.canvas.getContext("webgl");if(!e)return null;const o=ot(e,this.spec.fragment);if(!o)return null;const s=e.createBuffer();e.bindBuffer(e.ARRAY_BUFFER,s),e.bufferData(e.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),e.STATIC_DRAW);const a=n=>{const d=e.getAttribLocation(n,"a_pos");e.enableVertexAttribArray(d),e.vertexAttribPointer(d,2,e.FLOAT,!1,0,0)};e.useProgram(o),a(o);let r=null;if(this.spec.feedback){if(r=ot(e,At),!r)return null;e.useProgram(r),a(r),e.useProgram(o)}return{gl:e,program:o,copyProgram:r,locations:rt(e,o),copyLocations:r?rt(e,r):new Map,textures:null,framebuffers:null,prevIndex:0,width:0,height:0}}ensureTargets(e,o,s){if(!this.spec.feedback||e.textures&&e.width===o&&e.height===s)return;const{gl:a}=e;if(e.textures)for(const m of e.textures)a.deleteTexture(m);if(e.framebuffers)for(const m of e.framebuffers)a.deleteFramebuffer(m);const r=()=>{const m=a.createTexture();a.bindTexture(a.TEXTURE_2D,m),a.texImage2D(a.TEXTURE_2D,0,a.RGBA,o,s,0,a.RGBA,a.UNSIGNED_BYTE,null),a.texParameteri(a.TEXTURE_2D,a.TEXTURE_MIN_FILTER,a.LINEAR),a.texParameteri(a.TEXTURE_2D,a.TEXTURE_MAG_FILTER,a.LINEAR),a.texParameteri(a.TEXTURE_2D,a.TEXTURE_WRAP_S,a.CLAMP_TO_EDGE),a.texParameteri(a.TEXTURE_2D,a.TEXTURE_WRAP_T,a.CLAMP_TO_EDGE);const l=a.createFramebuffer();return a.bindFramebuffer(a.FRAMEBUFFER,l),a.framebufferTexture2D(a.FRAMEBUFFER,a.COLOR_ATTACHMENT0,a.TEXTURE_2D,m,0),[m,l]},[n,d]=r(),[f,_]=r();a.bindFramebuffer(a.FRAMEBUFFER,null),e.textures=[n,f],e.framebuffers=[d,_],e.prevIndex=0,e.width=o,e.height=s}setUniform(e,o,s,a){var d,f,_,m,l,g,y;const r=w=>{this.warned.has(o)||(this.warned.add(o),console.warn(`[glPreset] uniform ${o}: ${w}`))},n=w=>typeof w=="number"?[w]:w;if(s.type===e.FLOAT)if(s.size===1){const w=typeof a=="number"?a:(r("array sent to scalar; using [0]"),(d=n(a)[0])!=null?d:0);e.uniform1f(s.location,w)}else{const w=n(a);w.length!==s.size&&r(`length ${w.length} vs declared [${s.size}]; truncating/padding`);const i=new Float32Array(s.size);for(let x=0;x<s.size;x++)i[x]=(f=w[x])!=null?f:0;e.uniform1fv(s.location,i)}else if(s.type===e.FLOAT_VEC2){const w=n(a);w.length<2&&r("needs 2 components"),e.uniform2f(s.location,(_=w[0])!=null?_:0,(m=w[1])!=null?m:0)}else if(s.type===e.FLOAT_VEC3){const w=n(a);w.length<3&&r("needs 3 components"),e.uniform3f(s.location,(l=w[0])!=null?l:0,(g=w[1])!=null?g:0,(y=w[2])!=null?y:0)}else r(`unsupported uniform type 0x${s.type.toString(16)}`)}render(e,o,s,a){if(this.contextLost||o<1||s<1){e.fillStyle="#000",e.fillRect(0,0,o,s);return}this.pipeline||(this.pipeline=this.setup());const r=this.pipeline;if(!r){e.fillStyle="#000",e.fillRect(0,0,o,s);return}const{gl:n}=r;(this.canvas.width!==o||this.canvas.height!==s)&&(this.canvas.width=o,this.canvas.height=s),this.ensureTargets(r,o,s),n.viewport(0,0,o,s),n.useProgram(r.program);const d=r.locations.get("u_res");d&&n.uniform2f(d.location,o,s);const f=this.spec.uniforms(a);for(const[_,m]of Object.entries(f)){const l=r.locations.get(_);l&&this.setUniform(n,_,l,m)}if(this.spec.feedback&&r.textures&&r.framebuffers){const _=r.prevIndex,m=1-_;n.activeTexture(n.TEXTURE0),n.bindTexture(n.TEXTURE_2D,r.textures[_]);const l=r.locations.get("u_prev");l&&n.uniform1i(l.location,0),n.bindFramebuffer(n.FRAMEBUFFER,r.framebuffers[m]),n.drawArrays(n.TRIANGLE_STRIP,0,4),n.bindFramebuffer(n.FRAMEBUFFER,null),n.useProgram(r.copyProgram),n.bindTexture(n.TEXTURE_2D,r.textures[m]);const g=r.copyLocations.get("u_res");g&&n.uniform2f(g.location,o,s);const y=r.copyLocations.get("u_prev");y&&n.uniform1i(y.location,0),n.drawArrays(n.TRIANGLE_STRIP,0,4),r.prevIndex=m}else n.bindFramebuffer(n.FRAMEBUFFER,null),n.drawArrays(n.TRIANGLE_STRIP,0,4);e.drawImage(this.canvas,0,0)}}function _e(t){return new Tt(t)}const st=t=>`vec3(${t[0].toFixed(3)}, ${t[1].toFixed(3)}, ${t[2].toFixed(3)})`,Ct=t=>{let e=Math.floor(Math.abs(t))+2654435769>>>0;return e=Math.imul(e^e>>>16,569420461)>>>0,e=Math.imul(e^e>>>15,1935289751)>>>0,e=(e^e>>>15)>>>0,e/4294967296},It=`
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

const vec3 LOW = ${st(j[0])};
const vec3 HIGH = ${st(j[2])};

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
`,Et={id:"voyage",name:"Voyage",hiRes:!0,params:[{id:"stars",label:"star density",min:0,max:2,step:.05,default:1},{id:"dust",label:"dust amount",min:0,max:2,step:.05,default:1},{id:"palette",label:"palette blend (ember→nebula→aurora→solar)",min:0,max:3,step:.05,default:1},{id:"persistence",label:"persistence",min:.5,max:2,step:.05,default:1},{id:"speed",label:"flight speed",min:.2,max:2.5,step:.05,default:1}],create:()=>{let t=0,e=999,o=0,s=0,a=0,r=0,n=0,d=.5,f=0,_=0,m=null;return _e({fragment:It,feedback:!0,uniforms:l=>{var z,u,A,L,D,I,E,C;const g=t>0?Math.min(.1,Math.max(0,l.time-t)):.016666666666666666;t=l.time;const y=U(l.bands),w=(z=l.bandsSlow)!=null?z:l.bands,i=U(w),x=(u=l.params.speed)!=null?u:1,c=(A=l.params.persistence)!=null?A:1,k=Math.min(1,Math.max(0,(l.bands.low-.2)/.5)),T=1-Math.exp(-g/.35);a+=(l.trend.excitement*k-a)*T,r+=(l.trend.excitement*(1-k)-r)*T;const S=a,b=r,p=Math.min(1,y*1.4),h=Math.min(1,i*1.4),R=Math.max(S,.7*h),q=1+(.08+.7*R+3.6*l.impulse.low*(.5+.5*R))*x*g-.3*b*g;s+=g*((L=l.beat)!=null&&L.bpm?l.beat.bpm/60*Math.PI*2/64:.12),n=Math.min(1.4,n*Math.exp(-g/2.5)+l.impulse.low*.28),e+=g,l.impulse.low>.35&&e>.12&&(e=0,o=Math.min(1,l.impulse.low*1.2));const v=.992-.008*y-.008*b;d+=(l.centroid-d)*(1-Math.exp(-g/1));let M=null,H=-1;for(const B of l.decks)B.level>H&&(H=B.level,M=B.trackId);M!==null&&M!==m&&(m=M,_=Ct(M)),f+=(_-f)*(1-Math.exp(-g/2));const P=(d-.5)*.8,N=((f+P)%1+1)%1;return{u_time:l.time,u_low:l.bands.low,u_lowSlow:w.low,u_mid:l.bands.mid,u_midSlow:w.mid,u_high:l.bands.high,u_kick:l.impulse.low,u_snare:l.impulse.mid,u_centroid:l.centroid,u_specHue:d,u_hueRot:N,u_drop:S,u_buildup:b,u_zoom:q,u_rotStep:(.05+.5*w.mid+.5*b+.25*h)*x*g,u_decay:Math.min(.998,1-(1-v)/c),u_seed:Math.floor(l.time*20),u_rippleAge:e,u_rippleAmp:o,u_sustain:p,u_armPhase:s,u_charge:n,u_dust:(D=l.params.dust)!=null?D:1,u_palette:(I=l.params.palette)!=null?I:1,u_spawn:Math.min(1,1.15*l.impulse.high+.2*l.bands.high)*((E=l.params.stars)!=null?E:1)*(.4+.6*Math.max(S,p))/(1+1.8*b)/(1+2.2*l.impulse.low),u_spawnSnare:Math.min(1,.95*l.impulse.mid)*((C=l.params.stars)!=null?C:1)*(.5+.5*Math.max(S,p))/(1+.8*b)/(1+2.2*l.impulse.low)}}})}},Pt=160;class Ft{constructor(){Y(this,"buffer",null);Y(this,"bufferCtx",null);Y(this,"rotation",0)}ensureBuffer(e,o){return(!this.buffer||this.buffer.width!==e||this.buffer.height!==o)&&(this.buffer=document.createElement("canvas"),this.buffer.width=e,this.buffer.height=o,this.bufferCtx=this.buffer.getContext("2d")),this.bufferCtx}render(e,o,s,a){var k,T;const r=this.ensureBuffer(o,s),{low:n,mid:d,high:f}=a.bands,_=o/2,m=s/2,l=Math.min(o,s);if(e.globalCompositeOperation="source-over",e.fillStyle="#000",e.fillRect(0,0,o,s),this.buffer&&r){const S=(k=a.params.zoom)!=null?k:1,b=1+(.3+1.4*n*n+3.5*a.impulse.low)*S*a.dt;this.rotation=(.1+1.2*d+1.8*a.impulse.mid)*a.dt,e.save(),e.translate(_,m),e.rotate(this.rotation),e.scale(b,b),e.globalAlpha=.9+.095*((T=a.params.trail)!=null?T:.68),e.drawImage(this.buffer,-_,-m),e.restore(),e.globalAlpha=1}e.globalCompositeOperation="lighter";const g=ke(U(a.bands),a.time*6),y=l*(.1+.16*n),w=l*.02*d;e.beginPath();const i=64;for(let S=0;S<=i;S++){const b=S/i*Math.PI*2,p=y+Math.sin(b*6+a.time*3)*w,h=_+Math.cos(b)*p,R=m+Math.sin(b)*p;S===0?e.moveTo(h,R):e.lineTo(h,R)}e.closePath(),e.strokeStyle=`hsl(${g}, 100%, ${45+35*n}%)`,e.lineWidth=Math.max(2,l*(.004+.014*n)),e.stroke();const x=Pt*f*f*a.dt;let c=Math.floor(x)+(Math.random()<x%1?1:0);for(;c-- >0;){const S=Math.random()*Math.PI*2,b=y*(.9+Math.random()*.4),p=l*(.0015+.003*Math.random());e.fillStyle=`hsl(${(g+180+Math.random()*40)%360}, 100%, 75%)`,e.beginPath(),e.arc(_+Math.cos(S)*b,m+Math.sin(S)*b,p,0,Math.PI*2),e.fill()}e.globalCompositeOperation="source-over",r&&this.buffer&&(r.clearRect(0,0,o,s),r.drawImage(e.canvas,0,0))}}const Dt={id:"tunnel",name:"Tunnel",params:[{id:"trail",label:"trail length",min:0,max:1,step:.02,default:.68},{id:"zoom",label:"zoom drive",min:.3,max:2.5,step:.05,default:1}],create:()=>new Ft},nt=t=>"vec3("+t[0].toFixed(3)+", "+t[1].toFixed(3)+", "+t[2].toFixed(3)+")",Ht=t=>{let e=Math.floor(Math.abs(t))+2654435769>>>0;return e=Math.imul(e^e>>>16,569420461)>>>0,e=Math.imul(e^e>>>15,1935289751)>>>0,e=(e^e>>>15)>>>0,e/4294967296},qt=`precision highp float;
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

const vec3 LOW = `+nt(j[0])+`;
const vec3 HIGH = `+nt(j[2])+`;

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
`,Lt={id:"g02-voyage-prime",name:"g02 voyage-prime",hiRes:!0,params:[{id:"stars",label:"star density",min:0,max:2,step:.05,default:1},{id:"dust",label:"dust amount",min:0,max:2,step:.05,default:1},{id:"palette",label:"palette blend (ember→nebula→aurora→solar)",min:0,max:3,step:.05,default:1},{id:"persistence",label:"persistence",min:.5,max:2,step:.05,default:1},{id:"speed",label:"flight speed",min:.2,max:2.5,step:.05,default:1}],create:()=>{let t=0,e=999,o=0,s=0,a=0,r=0,n=0,d=null,f=0,_=0,m=0,l=.5,g=0,y=0,w=null;return _e({fragment:qt,feedback:!0,uniforms:i=>{var A,L,D,I,E,C,B,O,G;const x=t>0?Math.min(.1,Math.max(0,i.time-t)):.016666666666666666;t=i.time;const c=U(i.bands),k=(A=i.params.speed)!=null?A:1,T=(L=i.params.persistence)!=null?L:1,S=Math.min(1,Math.max(0,(i.bands.low-.2)/.5)),b=1-Math.exp(-x/.35);a+=(i.trend.excitement*S-a)*b,r+=(i.trend.excitement*(1-S)-r)*b;const p=a,h=r,R=Math.min(1,c*1.4),q=Math.max(p,.7*R),v=1+(.08+.7*q+3.6*i.impulse.low*(.5+.5*q))*k*x-.3*h*x;s+=x*((D=i.beat)!=null&&D.bpm?i.beat.bpm/60*Math.PI*2/64:.12),n=Math.min(1.4,n*Math.exp(-x/2.5)+i.impulse.low*.28),e+=x,i.impulse.low>.35&&e>.12&&(e=0,o=Math.min(1,i.impulse.low*1.2));const M=i.beat;let H;M&&M.barIndex!==null?(d!==null&&M.barIndex!==d&&(M.barIndex%4+4)%4===0&&(f=0),d=M.barIndex,H=((M.barIndex%4+4)%4+M.barPhase)/4):H=.5+.5*Math.sin(i.time*.35),f+=(H-f)*(1-Math.exp(-x/.5)),_+=(((I=i.spread)!=null?I:0)-_)*(1-Math.exp(-x/.4)),m+=(((E=i.flatness)!=null?E:0)-m)*(1-Math.exp(-x/.4));const P=.992-.008*c-.008*h;l+=(i.centroid-l)*(1-Math.exp(-x/1));let N=null,z=-1;for(const Q of i.decks)Q.level>z&&(z=Q.level,N=Q.trackId);N!==null&&N!==w&&(w=N,y=Ht(N)),g+=(y-g)*(1-Math.exp(-x/2));const u=((g+(l-.5)*.8)%1+1)%1;return{u_time:i.time,u_low:i.bands.low,u_mid:i.bands.mid,u_high:i.bands.high,u_kick:i.impulse.low,u_snare:i.impulse.mid,u_centroid:i.centroid,u_specHue:l,u_hueRot:u,u_drop:p,u_buildup:h,u_zoom:v,u_rotStep:(.05+.5*i.bands.mid+.5*h+.25*R)*k*x,u_decay:Math.min(.998,1-(1-P)/T),u_seed:Math.floor(i.time*20),u_rippleAge:e,u_rippleAmp:o,u_sustain:R,u_armPhase:s,u_charge:n,u_dust:(C=i.params.dust)!=null?C:1,u_palette:(B=i.params.palette)!=null?B:1,u_spawn:Math.min(1,1.15*i.impulse.high+.2*i.bands.high)*((O=i.params.stars)!=null?O:1)*(.4+.6*Math.max(p,R))/(1+1.8*h)/(1+2.2*i.impulse.low),u_spawnSnare:Math.min(1,.95*i.impulse.mid)*((G=i.params.stars)!=null?G:1)*(.5+.5*Math.max(p,R))/(1+.8*h)/(1+2.2*i.impulse.low),u_phrase:Math.min(1,Math.max(0,f)),u_spread:Math.min(1,Math.max(0,_)),u_flatness:Math.min(1,Math.max(0,m))}}})}},Nt=t=>{let e=Math.floor(Math.abs(t))+2654435769>>>0;return e=Math.imul(e^e>>>16,569420461)>>>0,e=Math.imul(e^e>>>15,1935289751)>>>0,e=(e^e>>>15)>>>0,e/4294967296},Ve=24,Bt=`
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
`,Te=16;function zt(t){let e=t+2654435769|0;return e=Math.imul(e^e>>>16,569420461),e=Math.imul(e^e>>>15,1935289751),e=e^e>>>15,(e>>>0)/4294967296}function je(t){let e=Math.floor(t)|0;const o=[];for(let s=0;s<4;s++)e=e+1831565813|0,o.push(zt(e+s*625341585));return[o[0],o[1],o[2],o[3]]}const Ot={id:"g05-materia-shards",name:"g05 materia-shards",hiRes:!0,params:[{id:"material",label:"material bias (glass↔sand)",min:-.5,max:.5,step:.02,default:0},{id:"sculpt",label:"spectrum sculpt",min:0,max:2,step:.05,default:1},{id:"grain",label:"sand grain",min:0,max:2,step:.05,default:1},{id:"glass",label:"glass caustics",min:0,max:2,step:.05,default:1},{id:"shards",label:"glass shards",min:0,max:2,step:.05,default:1},{id:"persistence",label:"persistence",min:.5,max:2,step:.05,default:1},{id:"growth",label:"phrase growth",min:0,max:2,step:.05,default:1}],create:()=>{let t=0,e=999,o=0,s=0,a=0,r=0,n=0,d=0,f=.5,_=0,m=0,l=null,g=0,y=0,w=-1,i=999,x=0,c=0,k=-1,T=je(0),S=1,b=!1,p=.5,h=.5,R=.5;const q=new Float32Array(Ve);return _e({fragment:Bt,feedback:!0,uniforms:v=>{var ge,he,oe,re,se,ne,ie,W,pe,be,we,xe,$,Me,Pe;const M=t>0?Math.min(.1,Math.max(0,v.time-t)):.016666666666666666;t=v.time;const H=(ge=v.params.persistence)!=null?ge:1,P=(he=v.params.growth)!=null?he:1,N=(oe=v.params.material)!=null?oe:0,z=1-Math.exp(-M/.3);let u=(re=v.decks.find(F=>F.channel===v.dominantChannel))!=null?re:null;if(u===null)for(const F of v.decks)F.playing&&(u===null||F.level>u.level)&&(u=F);const A=Math.min(1,Math.max(0,.6*v.flatness+.4*v.spread+N+(T[1]-.5)*.3));a+=(A-a)*z;const L=Math.min(1,Math.max(0,(v.bands.low-.2)/.5));r+=(v.trend.excitement*L-r)*z,n+=(v.trend.excitement*(1-L)-n)*z;const D=Math.min(1,(v.bands.low+v.bands.mid)*.7+r*.4);d+=(D-d)*(1-Math.exp(-M/.5)),f+=(v.centroid-f)*(1-Math.exp(-M/1));let I=null,E=-1;for(const F of v.decks)F.level>E&&(E=F.level,I=F.trackId);I!==null&&I!==l&&(l=I,m=Nt(I)),_+=(m-_)*(1-Math.exp(-M/2));const C=(se=v.beat)!=null&&se.bpm?v.beat.bpm/60*Math.PI*2/8:.35;s+=M*C*(.6+.9*a);let B=0,O=w,G=0;if(v.beat){const F=(ne=v.beat.ladderBarIndex)!=null?ne:v.beat.barIndex;B=((F%Te+Te)%Te+v.beat.barPhase)/Te,O=Math.floor(F/Te),G=Math.pow(1-v.beat.barPhase,2.4)}else B=.5-.5*Math.cos(v.time*.08),G=.5-.5*Math.cos(v.time*1.4);B=Math.min(1,B*P),O!==w&&w>=0&&(g=1,y=-y||1),w=O,g=Math.max(0,g-M/1.1);const Q=(ie=u==null?void 0:u.trackId)!=null?ie:null,ae=Q!==null?Q:Math.floor((v.centroid*331+v.spread*271+v.flatness*197)*101);b?ae!==k&&(k=ae,T=je(ae),S=0):(k=ae,T=je(ae),S=1,b=!0),S=Math.min(1,S+M/2);const J=1-Math.exp(-M/.15),fe=(W=u==null?void 0:u.eq.low)!=null?W:.5,ye=(pe=u==null?void 0:u.eq.mid)!=null?pe:.5,ce=(be=u==null?void 0:u.eq.high)!=null?be:.5;p+=(fe-p)*J,h+=(ye-h)*J,R+=(ce-R)*J;const V=v.spectrum;let te=0,ue=-1;for(let F=0;F<Ve;F++){const le=F<V.length?Math.min(1,Math.max(0,V[F])):0;q[F]=le,le>ue&&(ue=le,te=F)}e+=M,v.impulse.low>.35&&e>.12&&(e=0,o=Math.min(1,v.impulse.low*1.25)),i+=M;const Z=Math.max(v.impulse.mid,v.impulse.high*.85);if(Z>.12&&i>.09){i=0,x=Math.min(1,Z*1.3);const F=T[3]%1*Math.PI*2;c=te/Ve*Math.PI*2+F}const X=3+Math.floor(T[0]*7),ve=.99-.008*Math.min(1,(v.bands.low+v.bands.mid+v.bands.high)/2)-.006*n-.004*a;return{u_time:v.time,u_low:v.bands.low,u_mid:v.bands.mid,u_midSlow:((we=v.bandsSlow)!=null?we:v.bands).mid,u_high:v.bands.high,u_kick:v.impulse.low,u_snare:v.impulse.mid,u_centroid:v.centroid,u_material:a,u_phrase:B,u_section:Math.max(0,Math.min(1,g)),u_flip:y||1,u_drop:r,u_buildup:n,u_decay:Math.min(.997,1-(1-ve)/H),u_seed:T[3]*100,u_rippleAge:e,u_rippleAmp:o,u_flow:s,u_swell:d,u_grain:(xe=v.params.grain)!=null?xe:1,u_glass:($=v.params.glass)!=null?$:1,u_bar:G,u_rebirth:S,u_symmetry:X,u_gSculpt:((Me=v.params.sculpt)!=null?Me:1)*(.6+.8*T[2]),u_eqLow:p,u_eqMid:h,u_eqHigh:R,u_shardAge:i,u_shardAmp:x,u_shardAng:c,u_shards:(Pe=v.params.shards)!=null?Pe:1,u_specHue:f,u_hueAnchor:_,u_spectrum:q}}})}},Wt=t=>{let e=Math.floor(Math.abs(t))+2654435769>>>0;return e=Math.imul(e^e>>>16,569420461)>>>0,e=Math.imul(e^e>>>15,1935289751)>>>0,e=(e^e>>>15)>>>0,e/4294967296},Gt=`
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
`,Ce=16,Ut={id:"g02-materia",name:"g02 materia",hiRes:!0,params:[{id:"material",label:"material bias (glass↔sand)",min:-.5,max:.5,step:.02,default:0},{id:"grain",label:"sand grain",min:0,max:2,step:.05,default:1},{id:"glass",label:"glass caustics",min:0,max:2,step:.05,default:1},{id:"persistence",label:"persistence",min:.5,max:2,step:.05,default:1},{id:"growth",label:"phrase growth",min:0,max:2,step:.05,default:1}],create:()=>{let t=0,e=999,o=0,s=0,a=0,r=0,n=0,d=0,f=.5,_=0,m=0,l=null,g=0,y=0,w=-1;return _e({fragment:Gt,feedback:!0,uniforms:i=>{var z,u,A,L,D,I;const x=t>0?Math.min(.1,Math.max(0,i.time-t)):.016666666666666666;t=i.time;const c=(z=i.params.persistence)!=null?z:1,k=(u=i.params.growth)!=null?u:1,T=(A=i.params.material)!=null?A:0,S=1-Math.exp(-x/.3),b=Math.min(1,Math.max(0,.6*i.flatness+.4*i.spread+T));a+=(b-a)*S;const p=Math.min(1,Math.max(0,(i.bands.low-.2)/.5));r+=(i.trend.excitement*p-r)*S,n+=(i.trend.excitement*(1-p)-n)*S;const h=Math.min(1,(i.bands.low+i.bands.mid)*.7+r*.4);d+=(h-d)*(1-Math.exp(-x/.5)),f+=(i.centroid-f)*(1-Math.exp(-x/1));let R=null,q=-1;for(const E of i.decks)E.level>q&&(q=E.level,R=E.trackId);R!==null&&R!==l&&(l=R,m=Wt(R)),_+=(m-_)*(1-Math.exp(-x/2));const v=(L=i.beat)!=null&&L.bpm?i.beat.bpm/60*Math.PI*2/8:.35;s+=x*v*(.6+.9*a);let M=0,H=w;i.beat?(M=((i.beat.barIndex%Ce+Ce)%Ce+i.beat.barPhase)/Ce,H=Math.floor(i.beat.barIndex/Ce)):M=.5-.5*Math.cos(i.time*.08),M=Math.min(1,M*k),H!==w&&w>=0&&(g=1,y=-y||1),w=H,g=Math.max(0,g-x/1.1),e+=x,i.impulse.low>.35&&e>.12&&(e=0,o=Math.min(1,i.impulse.low*1.25));const N=.99-.008*Math.min(1,(i.bands.low+i.bands.mid+i.bands.high)/2)-.006*n-.004*a;return{u_time:i.time,u_low:i.bands.low,u_mid:i.bands.mid,u_high:i.bands.high,u_kick:i.impulse.low,u_snare:i.impulse.mid,u_centroid:i.centroid,u_material:a,u_phrase:M,u_section:Math.max(0,Math.min(1,g)),u_flip:y||1,u_drop:r,u_buildup:n,u_decay:Math.min(.997,1-(1-N)/c),u_seed:Math.floor(i.time*20),u_rippleAge:e,u_rippleAmp:o,u_flow:s,u_swell:d,u_grain:(D=i.params.grain)!=null?D:1,u_glass:(I=i.params.glass)!=null?I:1,u_specHue:f,u_hueAnchor:_}}})}},$t=t=>{let e=Math.floor(Math.abs(t))+2654435769>>>0;return e=Math.imul(e^e>>>16,569420461)>>>0,e=Math.imul(e^e>>>15,1935289751)>>>0,e=(e^e>>>15)>>>0,e/4294967296},it=24,Vt=`
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
`,Ie=16;function jt(t){let e=t+2654435769|0;return e=Math.imul(e^e>>>16,569420461),e=Math.imul(e^e>>>15,1935289751),e=e^e>>>15,(e>>>0)/4294967296}function Ke(t){let e=Math.floor(t)|0;const o=[];for(let s=0;s<4;s++)e=e+1831565813|0,o.push(jt(e+s*625341585));return[o[0],o[1],o[2],o[3]]}const Kt={id:"g03-materia-deep",name:"g03 materia-deep",hiRes:!0,params:[{id:"material",label:"material bias (glass↔sand)",min:-.5,max:.5,step:.02,default:0},{id:"sculpt",label:"spectrum sculpt",min:0,max:2,step:.05,default:1},{id:"grain",label:"sand grain",min:0,max:2,step:.05,default:1},{id:"glass",label:"glass caustics",min:0,max:2,step:.05,default:1},{id:"persistence",label:"persistence",min:.5,max:2,step:.05,default:1},{id:"growth",label:"phrase growth",min:0,max:2,step:.05,default:1}],create:()=>{let t=0,e=999,o=0,s=0,a=0,r=0,n=0,d=0,f=.5,_=0,m=0,l=null,g=0,y=0,w=-1,i=-1,x=Ke(0),c=1,k=!1,T=.5,S=.5,b=.5;const p=new Float32Array(it);return _e({fragment:Vt,feedback:!0,uniforms:h=>{var te,ue,Z,X,me,ve,ge,he,oe,re,se,ne,ie;const R=t>0?Math.min(.1,Math.max(0,h.time-t)):.016666666666666666;t=h.time;const q=(te=h.params.persistence)!=null?te:1,v=(ue=h.params.growth)!=null?ue:1,M=(Z=h.params.material)!=null?Z:0,H=1-Math.exp(-R/.3);let P=(X=h.decks.find(W=>W.channel===h.dominantChannel))!=null?X:null;if(P===null)for(const W of h.decks)W.playing&&(P===null||W.level>P.level)&&(P=W);const N=Math.min(1,Math.max(0,.6*h.flatness+.4*h.spread+M+(x[1]-.5)*.3));a+=(N-a)*H;const z=Math.min(1,Math.max(0,(h.bands.low-.2)/.5));r+=(h.trend.excitement*z-r)*H,n+=(h.trend.excitement*(1-z)-n)*H;const u=Math.min(1,(h.bands.low+h.bands.mid)*.7+r*.4);d+=(u-d)*(1-Math.exp(-R/.5)),f+=(h.centroid-f)*(1-Math.exp(-R/1));let A=null,L=-1;for(const W of h.decks)W.level>L&&(L=W.level,A=W.trackId);A!==null&&A!==l&&(l=A,m=$t(A)),_+=(m-_)*(1-Math.exp(-R/2));const D=(me=h.beat)!=null&&me.bpm?h.beat.bpm/60*Math.PI*2/8:.35;s+=R*D*(.6+.9*a);let I=0,E=w,C=0;h.beat?(I=((h.beat.barIndex%Ie+Ie)%Ie+h.beat.barPhase)/Ie,E=Math.floor(h.beat.barIndex/Ie),C=Math.pow(1-h.beat.barPhase,2.4)):(I=.5-.5*Math.cos(h.time*.08),C=.5-.5*Math.cos(h.time*1.4)),I=Math.min(1,I*v),E!==w&&w>=0&&(g=1,y=-y||1),w=E,g=Math.max(0,g-R/1.1);const B=(ve=P==null?void 0:P.trackId)!=null?ve:null,O=B!==null?B:Math.floor((h.centroid*331+h.spread*271+h.flatness*197)*101);k?O!==i&&(i=O,x=Ke(O),c=0):(i=O,x=Ke(O),c=1,k=!0),c=Math.min(1,c+R/2);const G=1-Math.exp(-R/.15),Q=(ge=P==null?void 0:P.eq.low)!=null?ge:.5,ae=(he=P==null?void 0:P.eq.mid)!=null?he:.5,J=(oe=P==null?void 0:P.eq.high)!=null?oe:.5;T+=(Q-T)*G,S+=(ae-S)*G,b+=(J-b)*G;const fe=h.spectrum;for(let W=0;W<it;W++){const pe=W<fe.length?fe[W]:0;p[W]=Math.min(1,Math.max(0,pe))}e+=R,h.impulse.low>.35&&e>.12&&(e=0,o=Math.min(1,h.impulse.low*1.25));const ye=3+Math.floor(x[0]*7),V=.99-.008*Math.min(1,(h.bands.low+h.bands.mid+h.bands.high)/2)-.006*n-.004*a;return{u_time:h.time,u_low:h.bands.low,u_mid:h.bands.mid,u_midSlow:((re=h.bandsSlow)!=null?re:h.bands).mid,u_high:h.bands.high,u_kick:h.impulse.low,u_snare:h.impulse.mid,u_centroid:h.centroid,u_material:a,u_phrase:I,u_section:Math.max(0,Math.min(1,g)),u_flip:y||1,u_drop:r,u_buildup:n,u_decay:Math.min(.997,1-(1-V)/q),u_seed:x[3]*100,u_rippleAge:e,u_rippleAmp:o,u_flow:s,u_swell:d,u_grain:(se=h.params.grain)!=null?se:1,u_glass:(ne=h.params.glass)!=null?ne:1,u_bar:C,u_rebirth:c,u_symmetry:ye,u_gSculpt:((ie=h.params.sculpt)!=null?ie:1)*(.6+.8*x[2]),u_eqLow:T,u_eqMid:S,u_eqHigh:b,u_specHue:f,u_hueAnchor:_,u_spectrum:p}}})}},Xt=t=>{let e=Math.floor(Math.abs(t))+2654435769>>>0;return e=Math.imul(e^e>>>16,569420461)>>>0,e=Math.imul(e^e>>>15,1935289751)>>>0,e=(e^e>>>15)>>>0,e/4294967296},lt=24,Yt=`
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
`,Se=8,Qt=16,Fe=4,ct=4,Jt=[{id:"material",label:"surface feel (glass↔sand)",min:-.5,max:.5,step:.02,default:0},{id:"sculpt",label:"spectrum sculpt",min:0,max:2,step:.05,default:1},{id:"grain",label:"grain",min:0,max:2,step:.05,default:1},{id:"glass",label:"caustics",min:0,max:2,step:.05,default:1},{id:"persistence",label:"persistence",min:.5,max:2,step:.05,default:1},{id:"cutStrength",label:"cut drama",min:0,max:2,step:.05,default:1}];function Zt(t){let e=t+2654435769|0;return e=Math.imul(e^e>>>16,569420461),e=Math.imul(e^e>>>15,1935289751),e=e^e>>>15,(e>>>0)/4294967296}function Xe(t){let e=Math.floor(t)|0;const o=[];for(let s=0;s<4;s++)e=e+1831565813|0,o.push(Zt(e+s*625341585));return[o[0],o[1],o[2],o[3]]}function ea(t){const e=t.decks.find(s=>s.channel===t.dominantChannel);if(e)return e;let o=null;for(const s of t.decks)s.playing&&(o===null||s.level>o.level)&&(o=s);return o}const ta={id:"g07-materia-metric",name:"g07 materia-metric",hiRes:!0,params:Jt,create:()=>{let t=0,e=999,o=0,s=0,a=0,r=0,n=0,d=0,f=.5,_=0,m=0,l=null,g=0,y=0,w=-1,i=Xe(0),x=1,c=!1,k=.5,T=.5,S=.5;const b=new Float32Array(lt);let p=0,h=0,R=0,q=0,v=0,M=0,H=null,P=null,N=null,z=-999;return _e({fragment:Yt,feedback:!0,uniforms:u=>{var oe,re,se,ne,ie,W,pe,be,we,xe,$,Me,Pe;const A=t>0?Math.min(.1,Math.max(0,u.time-t)):.016666666666666666;t=u.time;const L=(oe=u.params.persistence)!=null?oe:1,D=(re=u.params.material)!=null?re:0,I=(se=u.params.cutStrength)!=null?se:1,E=1-Math.exp(-A/.3),C=ea(u),B=Math.min(1,Math.max(0,.6*u.flatness+.4*u.spread+D+(i[1]-.5)*.3));a+=(B-a)*E;const O=Math.min(1,Math.max(0,(u.bands.low-.2)/.5));r+=(u.trend.excitement*O-r)*E,n+=(u.trend.excitement*(1-O)-n)*E;const G=Math.min(1,(u.bands.low+u.bands.mid)*.7+r*.4);d+=(G-d)*(1-Math.exp(-A/.5));const Q=Math.min(1,(u.bands.low+u.bands.mid+u.bands.high)/2),ae=Math.min(1,Q*1.4);f+=(u.centroid-f)*(1-Math.exp(-A/1));let J=null,fe=-1;for(const F of u.decks)F.level>fe&&(fe=F.level,J=F.trackId);J!==null&&J!==l&&(l=J,m=Xt(J)),_+=(m-_)*(1-Math.exp(-A/2));const ye=(ne=u.beat)!=null&&ne.bpm?u.beat.bpm/60*Math.PI*2/8:.35;s+=A*ye*(.6+.9*a+.6*n);let ce=0;u.beat?ce=Math.pow(1-u.beat.barPhase,2.4):ce=.5-.5*Math.cos(u.time*1.4);const V=u.beat?(ie=u.beat.ladderBarIndex)!=null?ie:u.beat.barIndex:null;let te=0;if(V!==null){const F=(V%Se+Se)%Se;te=(F+(u.beat?u.beat.barPhase:0))/Se;const le=Math.floor(V/Se),at=Math.floor(V/Qt);if((H===null||V!==H)&&(p=Math.min(Fe-1,F),M=0),P!==null&&le!==P){N!==null&&at!==N?(q=1,y=-y||1,h=(h+2+Math.abs(at)%2)%ct):(h=(h+1)%ct,g=1,y=-y||1),p=0,le-z>=1&&(R=I,z=le);const St=Math.max(r,.6*ae);St>.25&&(p=Fe-1,v=Math.min(1,St))}H=V,P=le,N=at}else te=.5-.5*Math.cos(u.time*.08),p=Math.min(Fe-1,Math.floor(te*Se%Fe)),H=null,P=null,N=null;g=Math.max(0,g-A/1.1),q=Math.max(0,q-A/.7),R=Math.max(0,R-A/.5),v=Math.max(0,v-A/1.4),M=Math.max(0,M-A/.6),e+=A,u.impulse.low>.35&&e>.12&&(e=0,o=Math.min(1,u.impulse.low*1.25),M=Math.min(1,M+u.impulse.low*.7));const ue=(W=C==null?void 0:C.trackId)!=null?W:null,Z=ue!==null?ue:Math.floor((u.centroid*331+u.spread*271+u.flatness*197)*101);c?Z!==w&&(w=Z,i=Xe(Z),x=0):(w=Z,i=Xe(Z),x=1,c=!0),x=Math.min(1,x+A/2);const X=1-Math.exp(-A/.15);k+=(((pe=C==null?void 0:C.eq.low)!=null?pe:.5)-k)*X,T+=(((be=C==null?void 0:C.eq.mid)!=null?be:.5)-T)*X,S+=(((we=C==null?void 0:C.eq.high)!=null?we:.5)-S)*X;const me=u.spectrum;for(let F=0;F<lt;F++){const le=F<me.length?me[F]:0;b[F]=Math.min(1,Math.max(0,le))}const ve=3+Math.floor(i[0]*7),he=.99-.008*Math.min(1,(u.bands.low+u.bands.mid+u.bands.high)/2)-.006*n-.004*a;return{u_time:u.time,u_low:u.bands.low,u_mid:u.bands.mid,u_midSlow:((xe=u.bandsSlow)!=null?xe:u.bands).mid,u_high:u.bands.high,u_kick:u.impulse.low,u_snare:u.impulse.mid,u_centroid:u.centroid,u_material:a,u_phrase:Math.min(1,te),u_section:Math.max(0,Math.min(1,g)),u_flip:y||1,u_drop:r,u_buildup:n,u_decay:Math.min(.997,1-(1-he)/L),u_seed:i[3]*100,u_rippleAge:e,u_rippleAmp:o,u_flow:s,u_swell:d,u_grain:($=u.params.grain)!=null?$:1,u_glass:(Me=u.params.glass)!=null?Me:1,u_bar:ce,u_rebirth:x,u_symmetry:ve,u_gSculpt:((Pe=u.params.sculpt)!=null?Pe:1)*(.6+.8*i[2]),u_eqLow:k,u_eqMid:T,u_eqHigh:S,u_strata:p,u_stackKick:Math.min(1,M),u_matBank:h,u_matCut:Math.min(1,R),u_fracture:Math.min(1,q),u_dropFull:Math.min(1,v),u_urgency:Math.min(1,n),u_specHue:f,u_hueAnchor:_,u_spectrum:b}}})}},aa=t=>{let e=Math.floor(Math.abs(t))+2654435769>>>0;return e=Math.imul(e^e>>>16,569420461)>>>0,e=Math.imul(e^e>>>15,1935289751)>>>0,e=(e^e>>>15)>>>0,e/4294967296},ut=t=>"vec3("+t[0].toFixed(3)+", "+t[1].toFixed(3)+", "+t[2].toFixed(3)+")",oa=["precision highp float;","uniform sampler2D u_prev;","uniform vec2 u_res;","uniform float u_time;","uniform float u_low;","uniform float u_mid;","uniform float u_high;","uniform float u_kick;","uniform float u_snare;","uniform float u_centroid;","uniform float u_specHue;","uniform float u_drop;","uniform float u_buildup;","uniform float u_zoom;","uniform float u_rotStep;","uniform float u_decay;","uniform float u_seed;","uniform float u_spawn;","uniform float u_rippleAge;","uniform float u_rippleAmp;","uniform float u_sustain;","uniform float u_armPhase;","uniform float u_dust;","uniform float u_palette;","uniform float u_charge;","uniform float u_spawnSnare;","uniform float u_hueRot;   // DUST FIX v3: per-song hue anchor + slow travel, TURNS 0..1","uniform float u_flareAge;","uniform float u_flareAmp;","uniform float u_flareSeed;","uniform float u_downbeat;","uniform float u_polarity;","","const vec3 LOW = "+ut(j[0])+";","const vec3 HIGH = "+ut(j[2])+";","","float hash(vec2 p) {","  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);","}","","float noise(vec2 p) {","  vec2 i = floor(p);","  vec2 f = fract(p);","  vec2 u = f * f * (3.0 - 2.0 * f);","  return mix(","    mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),","    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),","    u.y","  );","}","","float fbm(vec2 p) {","  float v = 0.0;","  float amp = 0.5;","  for (int i = 0; i < 4; i++) {","    v += amp * noise(p);","    p = p * 2.03 + vec2(17.3, 9.1);","    amp *= 0.5;","  }","  return v;","}","","vec3 pal0(float t) { return vec3(0.42, 0.14, 0.1) + vec3(0.42, 0.24, 0.14) * cos(6.28318 * (vec3(1.0, 0.9, 0.6) * t + vec3(0.0, 0.15, 0.25))); }","vec3 pal1(float t) { return vec3(0.45, 0.28, 0.42) + vec3(0.25, 0.35, 0.5) * cos(6.28318 * (vec3(1.0, 0.85, 0.7) * t + vec3(0.0, 0.2, 0.45))); }","vec3 pal2(float t) { return vec3(0.14, 0.36, 0.32) + vec3(0.3, 0.5, 0.45) * cos(6.28318 * (vec3(0.9, 1.0, 0.8) * t + vec3(0.1, 0.3, 0.5))); }","vec3 pal3(float t) { return vec3(0.5, 0.38, 0.24) + vec3(0.48, 0.42, 0.34) * cos(6.28318 * (vec3(1.0, 0.9, 0.8) * t + vec3(0.0, 0.12, 0.25))); }","","vec3 palette(float t) {","  float x = clamp(u_palette, 0.0, 3.0);","  vec3 c = mix(pal0(t), pal1(t), clamp(x, 0.0, 1.0));","  c = mix(c, pal2(t), clamp(x - 1.0, 0.0, 1.0));","  c = mix(c, pal3(t), clamp(x - 2.0, 0.0, 1.0));","  return c + vec3(0.1, -0.02, -0.05) * u_drop - vec3(0.06, 0.02, -0.04) * u_buildup;","}","","float starShape(vec2 f, float size) {","  float d2 = dot(f, f);","  float core = exp(-d2 * 1100.0 / size);","  float halo = exp(-d2 * 140.0 / size) * 0.2;","  float spikes = (exp(-abs(f.x) * 190.0 / size) * exp(-abs(f.y) * 16.0 / size)","    + exp(-abs(f.y) * 190.0 / size) * exp(-abs(f.x) * 16.0 / size)) * 0.55;","  return core + halo + spikes;","}","","// DUST FIX v3: value-preserving hue ROTATION (YIQ chroma plane). rot in","// TURNS; luminance (Y) untouched so gains are unchanged. Negatives clamped.","vec3 hueRotate(vec3 c, float rot) {","  float y = dot(c, vec3(0.299, 0.587, 0.114));","  float i = dot(c, vec3(0.596, -0.274, -0.322));","  float q = dot(c, vec3(0.211, -0.523, 0.312));","  float h = atan(q, i) + rot * 6.28318;","  float chroma = sqrt(i * i + q * q);","  i = chroma * cos(h);","  q = chroma * sin(h);","  return max(vec3(0.0), vec3(","    y + 0.956 * i + 0.621 * q,","    y - 0.272 * i - 0.647 * q,","    y - 1.106 * i - 1.703 * q","  ));","}","vec3 starScatter(vec2 c, float density, float sizeScale, float gate, float gain) {","  vec2 q = c * density;","  vec2 cell = floor(q);","  vec2 sc = cell + vec2(fract(u_seed * 0.7131) * 61.7, fract(u_seed * 0.3719) * 43.1);","  vec2 pos = vec2(hash(sc + 1.3), hash(sc.yx + 4.7)) * 0.7 + 0.15;","  vec2 f = fract(q) - pos;","  float on = step(gate - 0.09 * u_spawn, hash(sc * 1.618 + 9.7));","  float size = (0.5 + 1.5 * hash(sc.yx * 2.113)) * sizeScale;","  float bright = 0.4 + 0.6 * hash(sc + 17.9);","  vec3 tint = hueRotate(palette(hash(sc.yx + 29.3) * 1.6 + u_time * 0.02), u_hueRot);","  return mix(tint, HIGH, 0.2) * starShape(f, size) * on * bright * gain;","}","","void main() {","  vec2 uv = gl_FragCoord.xy / u_res;","  float aspect = u_res.x / u_res.y;","  vec2 c = (uv - 0.5) * vec2(aspect, 1.0);","  float r = length(c);","  float ang = atan(c.y, c.x);","  float t = u_time;","  vec2 px = 1.0 / u_res;","","  float rot = u_rotStep * (0.35 + 1.4 * exp(-r * 2.2));","  float cs = cos(rot);","  float sn = sin(rot);","  vec2 w = mat2(cs, -sn, sn, cs) * c / u_zoom;","  vec2 dirW = r > 1e-4 ? c / r : vec2(0.0);","  vec2 churn = (vec2(","    fbm(c * 2.6 + t * 0.12),","    fbm(c * 2.6 + vec2(7.7, 3.1) - t * 0.09)","  ) - 0.5) * (0.002 + 0.018 * u_mid + 0.012 * u_buildup);","  float waveFront = 0.16 + u_rippleAge * 0.9;","  float rippleWave = exp(-pow((r - waveFront) * 9.0, 2.0)) * exp(-u_rippleAge * 2.4) * u_rippleAmp;","  vec2 ripple = dirW * rippleWave * 0.035;","  float horizon = (0.14 + 0.1 * u_low) * (1.0 + 0.07 * u_charge);","  float lens = (0.4 * u_low + 1.5 * u_kick) * (1.0 + 0.9 * u_charge) * exp(-pow(r / horizon, 2.0) * 1.4);","  float drag = lens * 0.12;","  float dcs = cos(drag);","  float dsn = sin(drag);","  w = mat2(dcs, -dsn, dsn, dcs) * w;","  vec2 lensPull = dirW * lens * 0.055;","  vec2 src = (w + churn + ripple + lensPull) / vec2(aspect, 1.0) + 0.5;","","  vec2 ab = dirW * (0.0012 + 0.004 * u_drop + 0.003 * u_kick + 0.01 * rippleWave)","    / vec2(aspect, 1.0);","  ab *= u_dust; // fringe amount rides the dust param (human note)","  // fringe fix: hue-steerable fringes -- rotate the field to the anchor","  // frame, split channels there, rotate back. Clamped >= 0 (hueRotate can","  // go slightly negative) so the unsharp feedback loop stays stable.","  float fringeRot = u_hueRot;","  vec3 tapA = texture2D(u_prev, src + ab).rgb;","  vec3 tapC = texture2D(u_prev, src).rgb;","  vec3 tapB = texture2D(u_prev, src - ab).rgb;","  vec3 sampled = max(vec3(0.0), hueRotate(vec3(","    hueRotate(tapA, -fringeRot).r,","    hueRotate(tapC, -fringeRot).g,","    hueRotate(tapB, -fringeRot).b","  ), fringeRot));","  vec3 blur = (texture2D(u_prev, src + vec2(px.x, 0.0)).rgb","    + texture2D(u_prev, src - vec2(px.x, 0.0)).rgb","    + texture2D(u_prev, src + vec2(0.0, px.y)).rgb","    + texture2D(u_prev, src - vec2(0.0, px.y)).rgb) * 0.25;","  vec3 sky = max(vec3(0.0), sampled * 1.35 - blur * 0.35) * u_decay;","","  vec3 fresh = vec3(0.0);","  float volt = (noise(vec2(ang * 14.0 + t * 3.0, t * 22.0)) - 0.5)","    + 0.5 * (noise(vec2(ang * 30.0 - t * 5.0, t * 37.0)) - 0.5);","  float surf = horizon + volt * (0.012 + 0.05 * u_kick + 0.022 * u_low);","","  float bassWarp = u_low * (0.2 * sin(ang * 3.0 + t * 1.7) + 0.13 * sin(ang * 5.0 - t * 2.3))","    + 0.16 * u_kick * sin(ang * 7.0 + t * 9.0)","    + volt * (0.14 * u_low + 0.32 * u_kick);","  float rc = r * (1.0 - bassWarp * exp(-r * 3.0));","  float heart = exp(-rc * rc * (260.0 - 130.0 * u_kick));","  float coronaBody = exp(-rc * (7.0 - 3.0 * u_low));","  float gravity = sin(rc * 46.0 - t * (3.0 + 9.0 * u_low)) * 0.5 + 0.5;","  float gravityGain = u_low * (0.5 + 0.8 * u_kick);","  vec3 gravityColor = hueRotate(palette(0.05 + t * 0.015 + u_specHue * 0.5), u_hueRot);","  fresh += gravityColor","    * pow(gravity, 4.0) * exp(-r * 5.0) * gravityGain;","","  float life = clamp(u_flareAge / 1.0, 0.0, 1.0);","  float riseFall = sin(life * 3.14159265);","  riseFall = pow(riseFall, 0.7);","  float flareEnergy = u_flareAmp * exp(-u_flareAge * 1.6);","  float apexH = (0.10 + 0.30 * u_flareAmp) * riseFall;","  float promo = 0.0;","  float promoHot = 0.0;","  for (int i = 0; i < 3; i++) {","    float fi = float(i);","    float base = u_flareSeed * 6.28318530 + fi * 2.09439510","      + u_polarity * (0.35 + 0.25 * life);","    float span = 0.55 + 0.25 * hash(vec2(u_flareSeed * 13.1 + fi, 7.0));","    float apex = apexH * (0.7 + 0.6 * hash(vec2(fi * 3.7, u_flareSeed * 5.3)));","    float d = ang - base;","    d = mod(d + 3.14159265, 6.28318530) - 3.14159265;","    float s = d / max(span, 0.001);","    if (abs(s) <= 1.0) {","      float lobe = pow(cos(s * 1.5708), 1.4);","      float lineR = surf + apex * lobe;","      float dr = (r - lineR);","      float body = exp(-dr * dr * 900.0);","      float glowW = exp(-dr * dr * 120.0) * 0.5;","      float foot = smoothstep(1.0, 0.55, abs(s));","      promo += (body + glowW) * flareEnergy * (0.55 + 0.6 * foot);","      promoHot += body * flareEnergy * riseFall * (0.4 + 0.9 * foot);","    }","  }","  vec3 promColor = mix(vec3(1.0, 0.35, 0.08), vec3(1.0, 0.72, 0.3), clamp(apexH * 2.5, 0.0, 1.0));","  promColor = mix(promColor, vec3(1.0, 0.95, 0.85), clamp(u_downbeat * riseFall, 0.0, 1.0));","  fresh += promColor * promo * (0.6 + 1.4 * u_kick + 0.8 * u_charge);","  fresh += vec3(1.0, 0.9, 0.75) * promoHot * (0.5 + 1.0 * u_downbeat);","","  float coronaField = fbm(vec2(ang * 5.0 + u_polarity * t * 0.4, (r - surf) * 9.0 - t * 0.6));","  float streamers = 0.5 + 0.5 * sin(ang * 22.0 + u_polarity * t * 1.3 + coronaField * 6.0);","  float coronaBand = exp(-pow((r - surf) * 7.0, 2.0)) + exp(-pow((r - surf * 1.8) * 3.5, 2.0)) * 0.5;","  float coronaGain = (0.12 + 1.3 * u_mid + 0.4 * u_sustain) * (0.4 + 0.6 * coronaField);","  vec3 coronaColor = mix(vec3(1.0, 0.5, 0.15), palette(0.55 + t * 0.02), 0.4);","  fresh += coronaColor * coronaBand * pow(streamers, 2.0) * coronaGain;","","  vec3 coal = palette(0.0 + u_specHue * 0.5) * 0.55;","  fresh += mix(coal, vec3(1.0, 0.8, 0.7), 0.5 * u_kick) * heart * (0.5 + 1.2 * u_low + 1.4 * u_kick);","  fresh += mix(coal, LOW, 0.4) * coronaBody * (0.1 + 0.6 * u_low + 0.35 * u_kick);","  float centerDim = smoothstep(horizon * 0.45, horizon * 1.2, r);","  float streak = exp(-abs(c.y) * 110.0) * exp(-abs(c.x) * (4.5 - 1.5 * u_drop));","  fresh += hueRotate(mix(palette(0.7 + u_specHue * 0.5), palette(t * 0.02), 0.65), u_hueRot) * streak * (0.25 + 1.2 * u_low + 0.8 * u_kick);","","  float arm = sin(ang * 2.0 + log(r + 0.06) * 5.0 - u_armPhase + 0.5 * u_mid * sin(ang * 3.0 + r * 6.0 + t * 0.7));","  float lanes = pow(0.5 + 0.5 * arm, 3.0) * smoothstep(0.06, 0.2, r) * exp(-r * 1.8);","  float cloudField = fbm(vec2(ang * 2.2 + r * 3.0 - t * 0.15, r * 5.0 + t * 0.06));","  float cloud = pow(cloudField, 2.4);","  vec3 diskColor = hueRotate(palette(cloudField * 1.5 + r * 0.35 + ang * 0.1 + t * 0.012 + u_centroid * 0.4 + u_specHue * 0.8), u_hueRot);","  float reverb = 1.0 + 2.6 * rippleWave;","  float midGate = smoothstep(0.04, 0.3, u_mid);","  fresh += diskColor * lanes * (0.1 + 1.2 * u_mid) * (0.5 + cloud) * u_dust * centerDim * midGate * reverb;","  fresh += diskColor * cloud * exp(-r * 2.4) * u_mid * 0.45 * u_dust * centerDim * midGate * reverb;","","  float wisp = fbm(vec2(ang * 6.0 - t * 0.5, r * 10.0 + t * 0.25));","  float shimmer = 0.6 + 0.4 * sin(t * 13.0 + wisp * 24.0);","  vec3 electric = hueRotate(palette(0.35 + cloudField * 1.5 + r * 0.35 + ang * 0.1 + t * 0.012 + u_centroid * 0.4 + u_specHue * 0.8), u_hueRot);","  fresh += electric * pow(wisp, 3.2) * shimmer * smoothstep(0.12, 0.5, r)","    * (0.08 + 1.7 * u_high) * u_dust * reverb;","  sky += fresh * (1.0 - u_decay) * (3.2 + 1.6 * u_sustain);","","  if (u_spawn > 0.01) {","    vec2 sOff = vec2(fract(u_seed * 0.7131) * 21.7, fract(u_seed * 0.3719) * 13.1);","    float puff = pow(fbm(c * 7.0 + sOff), 3.5);","    sky += electric * puff * smoothstep(0.1, 0.4, r) * u_spawn * 0.9;","  }","","  if (u_kick > 0.02) {","    float ringR = 0.1 + 0.05 * u_kick;","    float shock = exp(-pow((r - ringR) * 38.0, 2.0))","      + 0.6 * exp(-pow((r - ringR * 1.7) * 30.0, 2.0));","    sky += mix(palette(0.05 + u_specHue * 0.5), vec3(1.0, 0.9, 0.8), 0.5) * shock * u_kick * (1.15 + 0.8 * u_drop);","    sky *= 1.0 + 0.1 * u_kick;","  }","  if (u_snare > 0.03) {","    float arc = exp(-pow((r - 0.3) * 30.0, 2.0)) * pow(0.5 + 0.5 * sin(ang * 3.0 + u_seed), 2.0);","    sky += palette(0.3 + t * 0.02) * arc * u_snare * 0.7;","  }","  if (u_spawn > 0.003 || u_spawnSnare > 0.003) {","    float reach = smoothstep(0.05, 0.18, r);","    sky += starScatter(c + 11.3, 16.0, 2.8, 0.984, u_spawnSnare * 1.2) * reach","      * mix(vec3(1.0), palette(0.15), 0.45);","  }","","  sky += (hash(gl_FragCoord.xy + fract(t) * 191.0) - 0.5) * (0.012 + 0.02 * u_drop);","","  vec3 grade = palette(0.35 + u_centroid * 0.2);","  sky = mix(sky, sky * (0.4 + grade * 1.5), 0.24);","  sky *= 0.72 + 0.45 * max(u_drop, u_sustain) - 0.05 * u_buildup;","  float m = max(sky.r, max(sky.g, sky.b));","  if (m > 0.8) {","    sky *= (0.8 + 0.2 * (1.0 - exp(-(m - 0.8) * 3.0))) / m;","  }","  gl_FragColor = vec4(max(sky, 0.0), 1.0);","}"].join(`
`),ra={id:"g03-solar-crown",name:"g03 solar-crown",hiRes:!0,params:[{id:"stars",label:"star density",min:0,max:2,step:.05,default:1.4},{id:"dust",label:"dust amount",min:0,max:2,step:.05,default:1},{id:"palette",label:"palette blend (ember→nebula→aurora→solar)",min:0,max:3,step:.05,default:3},{id:"persistence",label:"persistence",min:.5,max:2,step:.05,default:1},{id:"speed",label:"flight speed",min:.2,max:2.5,step:.05,default:1.4}],create:()=>{let t=0,e=999,o=0,s=0,a=0,r=0,n=0,d=999,f=0,_=0,m=null,l=1,g=1,y=.5,w=0,i=0,x=null;return _e({fragment:oa,feedback:!0,uniforms:c=>{var D,I,E,C,B,O;const k=t>0?Math.min(.1,Math.max(0,c.time-t)):.016666666666666666;t=c.time;const T=U(c.bands),S=(D=c.params.speed)!=null?D:1.4,b=(I=c.params.persistence)!=null?I:1,p=c.beat,h=Math.min(1,Math.max(0,(c.bands.low-.2)/.5)),R=1-Math.exp(-k/.35);a+=(c.trend.excitement*h-a)*R,r+=(c.trend.excitement*(1-h)-r)*R;const q=a,v=r,M=Math.min(1,T*1.4),H=Math.max(q,.7*M),P=1+(.08+.7*H+3.6*c.impulse.low*(.5+.5*H))*S*k-.3*v*k;s+=k*(p!=null&&p.bpm?p.bpm/60*Math.PI*2/64:.12),n=Math.min(1.4,n*Math.exp(-k/2.5)+c.impulse.low*.28),e+=k,c.impulse.low>.35&&e>.12&&(e=0,o=Math.min(1,c.impulse.low*1.2)),p&&p.barIndex!==null&&(m!==null&&p.barIndex!==m&&(p.barIndex%16+16)%16===0&&(l=-l),m=p.barIndex),g+=(l-g)*(1-Math.exp(-k/.6));const N=p&&p.barPhase!==null?Math.pow(1-Math.min(1,p.barPhase*1.5),2):.3;d+=k,c.impulse.low>.28&&d>.14&&(d=0,f=Math.min(1.4,c.impulse.low*(.8+.9*N)*(.8+.6*Math.max(q,M))),_=(c.time*.618+c.impulse.low*3.1)%1);const z=.992-.008*T-.008*v;y+=(c.centroid-y)*(1-Math.exp(-k/1));let u=null,A=-1;for(const G of c.decks)G.level>A&&(A=G.level,u=G.trackId);u!==null&&u!==x&&(x=u,i=aa(u)),w+=(i-w)*(1-Math.exp(-k/2));const L=((w+(y-.5)*.8)%1+1)%1;return{u_time:c.time,u_low:c.bands.low,u_mid:c.bands.mid,u_high:c.bands.high,u_kick:c.impulse.low,u_snare:c.impulse.mid,u_centroid:c.centroid,u_specHue:y,u_hueRot:L,u_drop:q,u_buildup:v,u_zoom:P,u_rotStep:(.05+.5*c.bands.mid+.5*v+.25*M)*S*k,u_decay:Math.min(.998,1-(1-z)/b),u_seed:Math.floor(c.time*20),u_rippleAge:e,u_rippleAmp:o,u_sustain:M,u_armPhase:s,u_charge:n,u_dust:(E=c.params.dust)!=null?E:1,u_palette:(C=c.params.palette)!=null?C:3,u_spawn:Math.min(1,1.15*c.impulse.high+.2*c.bands.high)*((B=c.params.stars)!=null?B:1.4)*(.4+.6*Math.max(q,M))/(1+1.8*v)/(1+2.2*c.impulse.low),u_spawnSnare:Math.min(1,.95*c.impulse.mid)*((O=c.params.stars)!=null?O:1.4)*(.5+.5*Math.max(q,M))/(1+.8*v)/(1+2.2*c.impulse.low),u_flareAge:d,u_flareAmp:f,u_flareSeed:_,u_downbeat:N,u_polarity:g}}})}},ht=.92,sa=.65,na=.42,pt=1.8,De=16,ia=200,He=(t,e,o)=>t+(e-t)*o,la=t=>Math.min(1,Math.max(0,t)),dt=t=>t*t*(3-2*t);class ca{constructor(){Y(this,"buffer",null);Y(this,"bufferCtx",null);Y(this,"rotation",0);Y(this,"chapter",0);Y(this,"drive",0)}ensureBuffer(e,o){return(!this.buffer||this.buffer.width!==e||this.buffer.height!==o)&&(this.buffer=document.createElement("canvas"),this.buffer.width=e,this.buffer.height=o,this.bufferCtx=this.buffer.getContext("2d")),this.bufferCtx}chapterTarget(e){const{trend:o,bands:s}=e,a=U(s),r=Math.max(o.excitement,a);let n;if(e.beat){const m=((e.beat.barIndex%De+De)%De+e.beat.barPhase)/De;n=m<.5?m*.4:.2+dt((m-.5)*2)*.8}else{const _=e.time%24/24;n=dt(_<.5?_*2:(1-_)*2)}const d=n*(1+1.1*o.excitement),f=Math.max(d,r*r);return la(f)}render(e,o,s,a){var u,A,L;const r=this.ensureBuffer(o,s),{low:n,mid:d,high:f}=a.bands,_=(u=a.bandsSlow)!=null?u:a.bands,m=o/2,l=s/2,g=Math.min(o,s),y=this.chapterTarget(a),w=1-Math.exp(-a.dt/.5);this.chapter+=(y-this.chapter)*w;const i=this.chapter,x=Math.max(a.trend.excitement,U(a.bands));this.drive+=(x-this.drive)*(1-Math.exp(-a.dt/.35));const c=(A=a.params.dreamTrail)!=null?A:ht,k=(L=a.params.punchZoom)!=null?L:pt,T=He(c,na,i),S=He(sa,k,i),b=i;if(e.globalCompositeOperation="source-over",e.fillStyle="#000",e.fillRect(0,0,o,s),this.buffer&&r){const D=a.impulse.low,I=1+(.28+1.4*_.low*_.low+(2.6+2.4*b)*D)*S*a.dt;this.rotation=(.08+(.9+.9*b)*_.mid+(1.4+1.4*b)*a.impulse.mid)*a.dt,e.save(),e.translate(m,l),e.rotate(this.rotation),e.scale(I,I),e.globalAlpha=.88+.11*T,e.drawImage(this.buffer,-m,-l),e.restore(),e.globalAlpha=1}e.globalCompositeOperation="lighter";const p=U(a.bands),h=He(60,-30,i),R=ke(p,a.time*6+h),q=g*(.1+.16*n),v=g*(.008+.03*(1-b))*d;e.beginPath();const M=64;for(let D=0;D<=M;D++){const I=D/M*Math.PI*2,E=6+4*b,C=q+Math.sin(I*E+a.time*(3+2*b))*v,B=m+Math.cos(I)*C,O=l+Math.sin(I)*C;D===0?e.moveTo(B,O):e.lineTo(B,O)}e.closePath();const H=42+30*n+15*b*a.impulse.low;if(e.strokeStyle=`hsl(${R}, 100%, ${Math.min(85,H)}%)`,e.lineWidth=Math.max(2,g*(.003+He(.016,.008,b)+.01*n)),e.stroke(),b>.55){const D=q*.6;e.beginPath(),e.arc(m,l,D,0,Math.PI*2),e.strokeStyle=`hsl(${(R+30)%360}, 100%, ${Math.min(80,55+20*a.impulse.low)}%)`,e.lineWidth=Math.max(1.5,g*.004*b),e.stroke()}const P=1+.8*b+.6*this.drive,N=ia*P*f*f*a.dt;let z=Math.floor(N)+(Math.random()<N%1?1:0);for(;z-- >0;){const D=Math.random()*Math.PI*2,I=q*(.9+Math.random()*.4),E=g*(.0015+.0035*Math.random());e.fillStyle=`hsl(${(R+180+Math.random()*40)%360}, 100%, 75%)`,e.beginPath(),e.arc(m+Math.cos(D)*I,l+Math.sin(D)*I,E,0,Math.PI*2),e.fill()}e.globalCompositeOperation="source-over",r&&this.buffer&&(r.clearRect(0,0,o,s),r.drawImage(e.canvas,0,0))}}const ua={id:"g04-tunnel-saga",name:"g04 tunnel-saga",params:[{id:"dreamTrail",label:"dream trail",min:0,max:1,step:.02,default:ht},{id:"punchZoom",label:"punch zoom",min:.3,max:2.5,step:.05,default:pt}],create:()=>new ca},ha=t=>{let e=Math.floor(Math.abs(t))+2654435769>>>0;return e=Math.imul(e^e>>>16,569420461)>>>0,e=Math.imul(e^e>>>15,1935289751)>>>0,e=(e^e>>>15)>>>0,e/4294967296},ft=t=>"vec3("+t[0].toFixed(3)+", "+t[1].toFixed(3)+", "+t[2].toFixed(3)+")",Re=(t,e)=>(t%e+e)%e,pa=`precision highp float;
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

const vec3 LOW = `+ft(j[0])+`;
const vec3 HIGH = `+ft(j[2])+`;

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
`,qe=[{hue:.5,warm:.1,sat:.95},{hue:.3,warm:.15,sat:.9},{hue:.9,warm:.35,sat:.95},{hue:.1,warm:.85,sat:.85}],da=[.5,.3,.9,.1],fa=[.87,.78,.58,.47],ma={id:"g07-seasons-neon",name:"g07 seasons-neon",hiRes:!0,params:[{id:"stars",label:"star density",min:0,max:2,step:.05,default:1},{id:"dust",label:"dust amount",min:0,max:2,step:.05,default:1},{id:"seasonDrift",label:"season drift (in-phrase hue turn)",min:0,max:2,step:.05,default:1},{id:"sweepSpeed",label:"section sweep speed",min:.3,max:3,step:.05,default:1},{id:"persistence",label:"persistence",min:.5,max:2,step:.05,default:1},{id:"speed",label:"flight speed",min:.2,max:2.5,step:.05,default:1}],create:()=>{let t=0,e=999,o=0,s=0,a=0,r=0,n=0,d=null,f=0,_=0,m=0,l=0,g=.5,y=0,w=0,i=null,x=0;const c={...qe[0]},k={...qe[0]};let T=1,S=0,b=null;return _e({fragment:pa,feedback:!0,uniforms:p=>{var ge,he,oe,re,se,ne,ie,W,pe,be,we,xe;const h=t>0?Math.min(.1,Math.max(0,p.time-t)):.016666666666666666;t=p.time;const R=U(p.bands),q=(ge=p.bandsSlow)!=null?ge:p.bands,v=(he=p.params.speed)!=null?he:1,M=(oe=p.params.persistence)!=null?oe:1,H=(re=p.params.seasonDrift)!=null?re:1,P=(se=p.params.sweepSpeed)!=null?se:1,N=Math.min(1,Math.max(0,(p.bands.low-.2)/.5)),z=1-Math.exp(-h/.35);a+=(p.trend.excitement*N-a)*z,r+=(p.trend.excitement*(1-N)-r)*z;const u=a,A=r,L=Math.min(1,R*1.4),D=Math.max(u,.7*L),I=1+(.08+.7*D+3.6*p.impulse.low*(.5+.5*D))*v*h-.3*A*h;s+=h*((ne=p.beat)!=null&&ne.bpm?p.beat.bpm/60*Math.PI*2/64:.12),n=Math.min(1.4,n*Math.exp(-h/2.5)+p.impulse.low*.28),e+=h,p.impulse.low>.35&&e>.12&&(e=0,o=Math.min(1,p.impulse.low*1.2));const E=p.beat,C=E?(ie=E.ladderBarIndex)!=null?ie:E.barIndex:null;let B;if(E&&C!==null?(d!==null&&C!==d&&Re(C,4)===0&&(f=0),B=(Re(C,4)+E.barPhase)/4):B=.5+.5*Math.sin(p.time*.35),f+=(B-f)*(1-Math.exp(-h/.5)),E&&C!==null){const $=Math.floor(C/16);if(b===null)b=$;else if($!==b){b=$,k.hue=c.hue,k.warm=c.warm,k.sat=c.sat;const Me=1+Re($,3);x=Re(x+Me,qe.length),S=Re($*1.7,Math.PI*2),T=0}}T=Math.min(1,T+h*1.6*P);const O=qe[x],G=Math.sin(f*Math.PI*2)*.03*H,Q=.08*H*Math.sin(f*Math.PI),ae=.06*H*(.5+.5*Math.cos(f*Math.PI*2)),J=O.hue+G,fe=Math.min(1,Math.max(0,O.warm+Q)),ye=Math.min(1,Math.max(0,O.sat+ae)),ce=1-Math.exp(-h/.25);let V=J-c.hue;V-=Math.round(V),c.hue=Re(c.hue+V*ce,1),c.warm+=(fe-c.warm)*ce,c.sat+=(ye-c.sat)*ce;const te=Math.min(1,Math.max(u,.6*L)),ue=Math.min(1,Math.max(u,.55*L))*(1-.7*f);l+=(ue-l)*(1-Math.exp(-h/.3));const Z=.992-.008*R-.008*A;E&&C!==null&&(d=C),_+=(((W=p.spread)!=null?W:0)-_)*(1-Math.exp(-h/.4)),m+=(((pe=p.flatness)!=null?pe:0)-m)*(1-Math.exp(-h/.4)),g+=(p.centroid-g)*(1-Math.exp(-h/1));let X=null,me=-1;for(const $ of p.decks)$.level>me&&(me=$.level,X=$.trackId);X!==null&&X!==i&&(i=X,w=ha(X)),y+=(w-y)*(1-Math.exp(-h/2));const ve=((y+(g-.5)*.8)%1+1)%1;return{u_time:p.time,u_low:p.bands.low,u_mid:p.bands.mid,u_high:p.bands.high,u_kick:p.impulse.low,u_snare:p.impulse.mid,u_centroid:p.centroid,u_specHue:g,u_hueRot:ve,u_drop:u,u_buildup:A,u_zoom:I,u_rotStep:(.05+.5*q.mid+.5*A+.25*L)*v*h,u_decay:Math.min(.998,1-(1-Z)/M),u_seed:Math.floor(p.time*20),u_rippleAge:e,u_rippleAmp:o,u_sustain:L,u_armPhase:s,u_charge:n,u_dust:(be=p.params.dust)!=null?be:1,u_spawn:Math.min(1,1.15*p.impulse.high+.2*p.bands.high)*((we=p.params.stars)!=null?we:1)*(.4+.6*Math.max(u,L))/(1+1.8*A)/(1+2.2*p.impulse.low),u_spawnSnare:Math.min(1,.95*p.impulse.mid)*((xe=p.params.stars)!=null?xe:1)*(.5+.5*Math.max(u,L))/(1+.8*A)/(1+2.2*p.impulse.low),u_phrase:Math.min(1,Math.max(0,f)),u_spread:Math.min(1,Math.max(0,_)),u_flatness:Math.min(1,Math.max(0,m)),u_hue:c.hue,u_warm:Math.min(1,Math.max(0,c.warm)),u_sat:Math.min(1,Math.max(0,c.sat)),u_hueOut:k.hue,u_warmOut:Math.min(1,Math.max(0,k.warm)),u_satOut:Math.min(1,Math.max(0,k.sat)),u_sweep:Math.min(1,Math.max(0,T)),u_sweepDir:S,u_dropSat:te,u_dropSlam:Math.min(1,Math.max(0,l)),u_pureA:da[x],u_pureB:fa[x]}}})}},Le={lowFloor:30,lowMid:250,midHigh:2500,highCeil:16e3},ga=[Le.lowFloor,Le.lowMid,Le.midHigh,Le.highCeil],_a=4.5,va=500,mt=-48,ba=-12,wa=.6,xa=.008,ka=.16,Ne={low:0,mid:0,high:0};function ya(t,e,o){const s=Math.log2(e/t)/o,a=[];for(let r=0;r<=o;r++)a.push(t*Math.pow(2,r*s));return a}function gt(t,e,o,s){const a=e/o,r=[];for(let n=0;n<s.length-1;n++)r.push(Sa(t,a,s[n],s[n+1]));return r}function Ma(t,e,o){const[s,a,r]=gt(t,e,o,ga);return{low:s,mid:a,high:r}}function Sa(t,e,o,s){let a=Math.max(1,Math.ceil(o/e)),r=Math.min(t.length-1,Math.floor(s/e));if(r<a&&([a,r]=[r,a]),a<1||a>=t.length)return 0;let n=0;for(let m=a;m<=r;m++){const l=t[m];if(!Number.isFinite(l))continue;const g=l+_a*Math.log2(m*e/va);n+=Math.pow(10,g/10)}const d=n/(r-a+1);if(d<=0)return 0;const f=10*Math.log10(d),_=Ga((f-mt)/(ba-mt));return Math.pow(_,wa)}function Ra(t,e,o){return e.map((s,a)=>{var r;return Be((r=t[a])!=null?r:0,s,o)})}function Aa(t,e,o){return{low:Be(t.low,e.low,o),mid:Be(t.mid,e.mid,o),high:Be(t.high,e.high,o)}}function Be(t,e,o){const s=e>t?xa:ka;if(s<=0)return e;const a=1-Math.exp(-Math.max(0,o)/s);return t+(e-t)*a}const Ta=.35,Ca=.7;function Ia(t,e,o){return{low:Ye(t.low,e.low,o),mid:Ye(t.mid,e.mid,o),high:Ye(t.high,e.high,o)}}function Ye(t,e,o){const s=e>t?Ta:Ca,a=1-Math.exp(-Math.max(0,o)/s);return t+(e-t)*a}const Ea=.25,Pa=.12,Fa=2.5,Da={reference:Ne,impulse:Ne};function Ha(t,e,o){const s=1-Math.exp(-Math.max(0,o)/Ea),a=Math.exp(-Math.max(0,o)/Pa),r=_=>{const m=Math.min(1,Math.max(0,e[_]-t.reference[_])*Fa);return{reference:t.reference[_]+(e[_]-t.reference[_])*s,impulse:Math.max(m,t.impulse[_]*a)}},n=r("low"),d=r("mid"),f=r("high");return{reference:{low:n.reference,mid:d.reference,high:f.reference},impulse:{low:n.impulse,mid:d.impulse,high:f.impulse}}}const qa=6,La=3,Na={slow:0,excitement:0};function Ba(t,e,o){const s=1-Math.exp(-Math.max(0,o)/qa),a=t.slow+(e-t.slow)*s;return{slow:a,excitement:Math.min(1,Math.max(0,(e-a)*La))}}function za(t){let e=0,o=0;for(let s=0;s<t.length;s++)e+=t[s],o+=t[s]*s;return e<=1e-6||t.length<2?.5:o/e/(t.length-1)}function Oa(t){let e=0,o=0;for(let n=0;n<t.length;n++)e+=t[n],o+=t[n]*n;if(e<=1e-6||t.length<2)return .5;const s=o/e;let a=0;for(let n=0;n<t.length;n++)a+=t[n]*(n-s)*(n-s);a/=e;const r=(t.length-1)/2;return Math.min(1,Math.sqrt(a)/r)}function Wa(t){const e=t.length;if(e<2)return .5;let o=0,s=0;const a=1e-4;for(let d=0;d<e;d++){const f=Math.max(a,t[d]);o+=Math.log(f),s+=f}const r=s/e;if(r<=a*1.5)return .5;const n=Math.exp(o/e);return Math.min(1,n/r)}function Ga(t){return Math.min(1,Math.max(0,t))}const Ua={fast:0,med:0,slow:0,peak:0,riser:0,drop:0,sustained:0,breakdown:0,primed:0,sinceDropS:1/0},Ae=(t,e)=>1-Math.exp(-Math.max(0,t)/e);function $a(t){return Math.min(1,t.low*.55+t.mid*.3+t.high*.15)}function Va(t,e,o){const s=$a(e),a=t.fast+(s-t.fast)*Ae(o,.25),r=t.med+(a-t.med)*Ae(o,2),n=t.slow+(a-t.slow)*Ae(o,10),d=Math.max(a,t.peak*Math.exp(-o/12)),f=Math.max(0,a-r),_=Math.min(1,Math.max(0,(e.mid+e.high)*.75-e.low*.6+.25)),m=Math.min(1,f*10)*_;let l=t.riser+(m-t.riser)*Ae(o,m>t.riser?1.2:.8);l=Math.min(1,Math.max(0,l));const g=Math.max(l,t.primed*Math.exp(-o/4)),y=e.low>.45&&a>n*1.15+.05;let w=t.drop*Math.exp(-o/3),i=t.sinceDropS+o;y&&g>.35&&t.sinceDropS>4&&(w=Math.max(w,Math.min(1,g+.3)),i=0,l=0);const x=Math.min(1,Math.max(0,(a-n*1.05)/.25))*Math.min(1,a/.35),c=t.sustained+(x-t.sustained)*Ae(o,.6),k=Math.min(1,Math.max(0,(n*.7-a)/.2))*Math.min(1,d/.3),T=t.breakdown+(k-t.breakdown)*Ae(o,1);return{fast:a,med:r,slow:n,peak:d,riser:l,drop:w,sustained:c,breakdown:T,primed:g,sinceDropS:i}}function ja(t){return{buildup:t.riser,dropTransition:t.drop,sustained:t.sustained,breakdown:t.breakdown,dropAgeS:t.sinceDropS}}const Ka={levels:{},dominantId:null};function Xa(t,e,o,s={}){var g,y,w,i,x;const a=(g=s.tauSeconds)!=null?g:.7,r=(y=s.takeoverRatio)!=null?y:1.2,n=Math.max(0,Math.min(1,o)),d=1-Math.exp(-n/a),f={},_=new Set;for(const c of e){const k=(w=t.levels[c.id])!=null?w:0;f[c.id]=k+(c.level-k)*d,c.eligible&&_.add(c.id)}const m=()=>{var T;let c=null,k=-1/0;for(const S of _){const b=(T=f[S])!=null?T:0;b>k&&(k=b,c=S)}return c};let l=t.dominantId;if(l===null||!_.has(l))l=m();else{const c=(i=f[l])!=null?i:0,k=m();k!==null&&k!==l&&((x=f[k])!=null?x:0)>c*r+1e-6&&(l=k)}return{levels:f,dominantId:l}}const _t=24,vt=[20,60,150,400,1e3,2500,6e3,12e3,2e4],Qe=48e3,ze=2048,Ee=ze/2,Ya=-6,Je=new Int8Array(Ee).fill(-1),Ze=new Array(8).fill(0);for(let t=1;t<Ee;t++){const e=t*Qe/ze;for(let o=0;o<8;o++)if(e>=vt[o]&&e<vt[o+1]){Je[t]=o,Ze[o]++;break}}function Qa(t,e=new Float32Array(Ee),o=Ya){var a;const s=new Array(8);for(let r=0;r<8;r++){const n=(a=t[r])!=null?a:0;s[r]=n>1e-6&&Ze[r]>0?20*Math.log10(n)-10*Math.log10(Ze[r])+o:-1/0}for(let r=0;r<Ee;r++)e[r]=Je[r]<0?-1/0:s[Je[r]];return e}function Ja(t){var o;const e=new Array(8).fill(0);for(const s of t)if(s.playing)for(let a=0;a<8;a++){const r=((o=s.bands[a])!=null?o:0)*s.gain;e[a]+=r*r}return e.map(Math.sqrt)}function Za(t){if(!t.playing)return 0;let e=0;for(const s of t.bands)e+=s*s;const o=10*Math.log10(Math.max(1e-12,e))+20*Math.log10(Math.max(1e-6,t.gain));return Math.min(1,Math.max(0,(o+36)/30))}function bt(t){return!t.bpm||t.bpm<=0?null:{beats:(t.pos-t.anchor)*t.bpm/60}}const wt=t=>t-Math.floor(t),Oe=(t,e)=>(t%e+e)%e;function eo(){const t=ya(40,16e3,_t),e=new Float32Array(Ee);let o=Ne,s=Ne,a=new Array(_t).fill(0),r=Da,n=Na,d=Ua,f=Ka,_=0;return{frameAt(m,l,g){var S;_+=l,Qa(Ja(m.decks),e);const y=Ma(e,Qe,ze),w=gt(e,Qe,ze,t);o=Aa(o,y,l),s=Ia(s,y,l),a=Ra(a,w,l),r=Ha(r,y,l),n=Ba(n,U(y),l),d=Va(d,y,l);const i=m.decks.map(b=>{const p=b.playing?bt(b):null;return{channel:b.ch,level:Za(b),playing:b.playing,trackId:b.trackId,beatPhase:p?wt(p.beats):null,barPhase:p?Oe(p.beats,4)/4:null,beatInBar:p?Math.floor(Oe(p.beats,4)):null,beatsPerBar:4,bpm:b.bpm?b.bpm*b.rate:null,eq:{low:b.eq[0],mid:b.eq[1],high:b.eq[2]},fader:b.fader}});f=Xa(f,i.map(b=>({id:b.channel,level:b.level,eligible:b.playing&&b.level>.02})),l);const x=(S=f.dominantId)!=null?S:null,c=m.decks.find(b=>b.ch===x),k=c?bt(c):null,T=k&&c?{phase:wt(k.beats),barPhase:Oe(k.beats,4)/4,beatInBar:Math.floor(Oe(k.beats,4)),beatsPerBar:4,barIndex:Math.floor(k.beats/4),ladderBarIndex:k.beats>=0?Math.floor(k.beats/4):null,bpm:c.bpm?c.bpm*c.rate:null}:null;return{bands:o,bandsSlow:s,spectrum:a,wave:null,beat:T,impulse:r.impulse,trend:n,regime:ja(d),centroid:za(a),spread:Oa(a),flatness:Wa(a),decks:i,dominantChannel:x,params:g,time:_,dt:l}}}}const We=[["voyage",Et],["g02-voyage-prime",Lt],["g05-materia-shards",Ot],["g02-materia",Ut],["g03-materia-deep",Kt],["g07-materia-metric",ta],["g03-solar-crown",ra],["g07-seasons-neon",ma],["tunnel",Dt],["g04-tunnel-saga",ua]],K=document.getElementById("viz"),to=K.getContext("2d",{alpha:!1}),xt=document.getElementById("hud"),ao=eo(),de={scale:.5,fps:30,debug:!1,gainDb:0,opacity:.7};let ee=null;function kt(t){var a,r,n,d;const e=(a=We.find(([f])=>f===t))!=null?a:We[0];(n=ee==null?void 0:(r=ee.renderer).dispose)==null||n.call(r);const o=e[1],s={};for(const f of(d=o.params)!=null?d:[])s[f.id]=f.default;ee={id:e[0],preset:o,renderer:o.create(),params:s}}function oo(){const t=window.devicePixelRatio||1,e=Math.max(1,Math.round(K.clientWidth*t*de.scale)),o=Math.max(1,Math.round(K.clientHeight*t*de.scale));(K.width!==e||K.height!==o)&&(K.width=e,K.height=o)}const yt={decks:[]};function ro(){var t;try{const e=(t=window.ManadjVizHost)==null?void 0:t.frame();return e?JSON.parse(e):yt}catch{return yt}}let Ge=0,Ue=0,$e=0,et=0,tt=0;function Mt(t){var _,m,l;requestAnimationFrame(Mt);const e=1e3/de.fps;if(t-Ge<e-2)return;const o=Ge?Math.min(.1,(t-Ge)/1e3):1/de.fps;if(Ge=t,!ee)return;oo();const s=performance.now(),a=ro(),r=Math.pow(10,de.gainDb/20);if(r!==1)for(const g of a.decks)g.gain*=r;const n=performance.now(),d=ao.frameAt(a,o,ee.params);ee.renderer.render(to,K.width,K.height,d);const f=performance.now();if(Ue+=(f-n-Ue)*.05,$e+=(n-s-$e)*.05,et++,de.debug){const g=d.bands;xt.textContent=`${ee.id} ${K.width}x${K.height} render ${Ue.toFixed(1)}ms pull ${$e.toFixed(1)}ms
L ${g.low.toFixed(2)} M ${g.mid.toFixed(2)} H ${g.high.toFixed(2)} imp ${d.impulse.low.toFixed(2)} exc ${d.trend.excitement.toFixed(2)}
dom ${(_=d.dominantChannel)!=null?_:"-"} beat ${d.beat?`${d.beat.beatInBar+1}/${d.beat.barIndex} ${(m=d.beat.bpm)==null?void 0:m.toFixed(1)}`:"-"}`}if(t-tt>2e3){const g=et*1e3/(t-tt||1);tt=t,et=0,(l=window.ManadjVizHost)==null||l.stats(JSON.stringify({preset:ee.id,renderMs:Ue,pullMs:$e,fps:g,w:K.width,h:K.height}))}}window.manadjViz={presets:()=>JSON.stringify(We.map(([t,e])=>({id:t,name:e.name}))),setPreset:t=>{(ee==null?void 0:ee.id)!==t&&kt(t)},setOptions:t=>{Object.assign(de,JSON.parse(t)),xt.style.display=de.debug?"block":"none",K.style.opacity=String(de.opacity)}},kt(We[0][0]),requestAnimationFrame(Mt)})();
