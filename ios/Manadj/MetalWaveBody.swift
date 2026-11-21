import UIKit
import MetalKit
import ManadjCore

/// Opt-in experiment. Source MWF bytes are uploaded once; visible-column
/// reduction, band mixing, color and quad generation execute on the GPU.
/// CPU owns transport/gestures and the existing cue/grid overlay.
@MainActor final class MetalWaveBody: MTKView {
    struct Uniforms {
        var geometry: SIMD4<Float>
        var audio: SIMD4<Float>
        var config: SIMD4<UInt32>
    }
    private let inFlight = DispatchSemaphore(value: 3)
    private let queue: MTLCommandQueue
    private let reduction: MTLComputePipelineState
    private let paint: MTLRenderPipelineState
    private var bands: MTLBuffer?
    private var columns: MTLBuffer?
    private var columnCapacity = 0
    private var identity: UInt64?
    private var uploadedBytes = 0
    private var frameCount = 0
    private(set) var lastCPUEncodeMS = 0.0
    private(set) var failure: String?

    init?(experimentFrame frame: CGRect) {
        guard let device = MTLCreateSystemDefaultDevice(), let queue = device.makeCommandQueue() else { return nil }
        do {
            let library = try device.makeLibrary(source: Self.shader, options: nil)
            guard let reduce = library.makeFunction(name: "reduceColumns"),
                  let vertex = library.makeFunction(name: "waveVertex"),
                  let fragment = library.makeFunction(name: "waveFragment") else { return nil }
            reduction = try device.makeComputePipelineState(function: reduce)
            let descriptor = MTLRenderPipelineDescriptor()
            descriptor.vertexFunction = vertex; descriptor.fragmentFunction = fragment
            descriptor.colorAttachments[0].pixelFormat = .bgra8Unorm
            paint = try device.makeRenderPipelineState(descriptor: descriptor)
        } catch { print("METAL_WAVE_INIT_FAILED \(error)"); return nil }
        self.queue = queue
        super.init(frame: frame, device: device)
        colorPixelFormat = .bgra8Unorm
        clearColor = MTLClearColorMake(0, 0, 0, 1)
        isPaused = true; enableSetNeedsDisplay = false
        framebufferOnly = false
        isUserInteractionEnabled = false
        autoResizeDrawable = true
        accessibilityIdentifier = "metal-wave-body"
    }
    required init(coder: NSCoder) { fatalError("init(coder:) unavailable") }

    private func prepare(_ wave: PreviewWaveform, source: UInt64, count: Int) -> Bool {
        guard let device else { return false }
        if identity != source || uploadedBytes != wave.bands.count || bands == nil {
            bands = wave.bands.withUnsafeBytes { raw in
                guard let base = raw.baseAddress else { return nil }
                return device.makeBuffer(bytes: base, length: raw.count, options: .storageModeShared)
            }
            identity = source; uploadedBytes = wave.bands.count
        }
        if count > columnCapacity {
            columns = device.makeBuffer(length: max(1, count) * 64, options: .storageModePrivate)
            columnCapacity = count
        }
        return bands != nil && columns != nil
    }

    /// The optional target is for isolated GPU-completion timing/readback tests.
    /// The live path never waits for GPU completion on the main thread.
    @discardableResult func render(wave: PreviewWaveform, source: UInt64, start: Double,
                                  span: Double, gain: Double, vertical: Bool,
                                  target: MTLTexture? = nil, wait: Bool = false) -> (cpuMS: Double, gpuMS: Double)? {
        guard wave.nBands == 8, wave.bandFrames > 0, span > 0, wave.bandHop > 0 else { return nil }
        let begin = ProcessInfo.processInfo.systemUptime
        if !wait && inFlight.wait(timeout: .now()) != .success { return nil }
        var committed = false
        defer { if !wait && !committed { inFlight.signal() } }
        let drawable = target == nil ? currentDrawable : nil
        guard let texture = target ?? drawable?.texture else { return nil }
        let along = vertical ? texture.height : texture.width
        let count = (along + 1) / 2 + 2
        guard prepare(wave, source: source, count: count), let command = queue.makeCommandBuffer(),
              let compute = command.makeComputeCommandEncoder() else { return nil }
        command.label = "manaDJ Metal waveform experiment"
        var u = Uniforms(geometry: SIMD4(Float(texture.width), Float(texture.height), Float(start), Float(span)),
                         audio: SIMD4(Float(wave.sampleRate) / Float(wave.bandHop), Float(wave.stftWindow) * 0.5 / Float(wave.bandHop), Float(gain), Float(wave.durationSecs)),
                         config: SIMD4(UInt32(wave.bandFrames), UInt32(count), vertical ? 1 : 0, 0))
        compute.setComputePipelineState(reduction)
        compute.setBuffer(bands, offset: 0, index: 0); compute.setBuffer(columns, offset: 0, index: 1)
        compute.setBytes(&u, length: MemoryLayout<Uniforms>.stride, index: 2)
        let width = min(64, reduction.maxTotalThreadsPerThreadgroup)
        compute.dispatchThreads(MTLSize(width: count, height: 1, depth: 1), threadsPerThreadgroup: MTLSize(width: width, height: 1, depth: 1))
        compute.endEncoding()
        let pass = MTLRenderPassDescriptor()
        pass.colorAttachments[0].texture = texture
        pass.colorAttachments[0].loadAction = .clear; pass.colorAttachments[0].storeAction = .store
        pass.colorAttachments[0].clearColor = clearColor
        guard let encoder = command.makeRenderCommandEncoder(descriptor: pass) else { return nil }
        encoder.setRenderPipelineState(paint)
        encoder.setVertexBuffer(columns, offset: 0, index: 0)
        encoder.setVertexBytes(&u, length: MemoryLayout<Uniforms>.stride, index: 1)
        // Largest band first, then inner bands, preserving Android overlap order.
        encoder.drawPrimitives(type: .triangle, vertexStart: 0, vertexCount: 6, instanceCount: count * 3)
        encoder.endEncoding()
        if let drawable { command.present(drawable) }
        if !wait { let gate = inFlight; command.addCompletedHandler { _ in gate.signal() } }
        command.commit(); committed = true
        lastCPUEncodeMS = (ProcessInfo.processInfo.systemUptime - begin) * 1000
        frameCount += 1
        if wait {
            command.waitUntilCompleted()
            guard command.status == .completed else { failure = command.error?.localizedDescription ?? "GPU command failed"; return nil }
            return (lastCPUEncodeMS, max(0, command.gpuEndTime - command.gpuStartTime) * 1000)
        }
        return (lastCPUEncodeMS, 0)
    }

    private static let shader = """
    #include <metal_stdlib>
    using namespace metal;
    struct U { float4 geometry; float4 audio; uint4 config; };
    struct Column { float4 levels; float4 c0; float4 c1; float4 c2; };
    float3 color(uint mask, float3 g) {
        const float3 colors[3] = {float3(.7804,.0588,.0588),float3(.2353,.6863,.0706),float3(.0588,.5922,1)};
        float3 rgb=0;
        for(uint k=0;k<3;k++) if(mask & (1u<<k)) rgb+=colors[k];
        float over=clamp(max(rgb.r,max(rgb.g,rgb.b))-1.f,0.f,1.f); rgb=min(rgb,1.f);
        if(over>0) {
            float3 w=round(g*g*8.f)/8.f;
            float3 hue=(w.x*colors[0]+w.y*colors[1]+w.z*colors[2])/(w.x+w.y+w.z+.000001f);
            hue/=(max(hue.r,max(hue.g,hue.b))+.000001f);
            float white=min(1.f,.32f+.3f*over), t=clamp(over/.5f,0.f,1.f); t=t*t*(3.f-2.f*t);
            rgb=mix(rgb,mix(hue,float3(1),white),t);
        }
        return round(clamp(rgb,0.f,1.f)*31.f)/31.f;
    }
    kernel void reduceColumns(device const uchar *bands [[buffer(0)]], device Column *out [[buffer(1)]], constant U &u [[buffer(2)]], uint x [[thread_position_in_grid]]) {
        if(x>=u.config.y) return;
        float along=u.config.z ? u.geometry.y : u.geometry.x;
        float dt=u.geometry.w/along*2.f, first=floor(u.geometry.z/dt), t0=(first+float(x))*dt;
        float x0=t0*u.audio.x-u.audio.y, x1=(t0+dt)*u.audio.x-u.audio.y;
        float g[3]={0,0,0};
        if(t0+dt>=0 && t0<=u.audio.w && x0<float(u.config.x)) {
            for(uint k=0;k<8;k++) {
                float b=0;
                if(x1-x0<1.f) {
                    int a=clamp(int(floor((x0+x1)*.5f)),0,max(0,int(u.config.x)-2)), z=min(a+1,int(u.config.x)-1);
                    float f=clamp((x0+x1)*.5f-float(a),0.f,1.f);
                    b=mix(float(bands[a*8+k]),float(bands[z*8+k]),f)/255.f;
                } else {
                    int a=clamp(int(floor(x0)),0,int(u.config.x)-1), z=clamp(int(floor(x1)),a,int(u.config.x)-1);
                    int step=max(1,(z-a)/12), n=0;
                    for(int i=a;i<=z;i+=step) { b+=float(bands[i*8+k])/255.f; n++; } b/=float(n);
                }
                g[k<3 ? 0 : k<5 ? 1 : 2]+=b*b*b*b;
            }
        }
        const float gains[3]={.7f,1.05f,1.5f};
        for(uint k=0;k<3;k++) { float v=sqrt(g[k])*gains[k]; g[k]=min(1.f,(v<=.6f?v:.6f+.4f*(1.f-exp(-(v-.6f)/.4f)))*u.audio.z); }
        float3 groups=float3(g[0],g[1],g[2]);
        uint order[3]={0,1,2};
        for(uint a=0;a<2;a++) for(uint b=a+1;b<3;b++) if(g[order[b]]>g[order[a]]) { uint z=order[a];order[a]=order[b];order[b]=z; }
        Column c; c.levels=float4(g[order[0]],g[order[1]],g[order[2]],0);
        float4 cs[3];
        for(uint k=0;k<3;k++) { uint mask=0;for(uint j=0;j<3;j++) if(g[j]>=g[order[k]])mask|=1u<<j;cs[k]=float4(color(mask,groups),1); }
        c.c0=cs[0];c.c1=cs[1];c.c2=cs[2];out[x]=c;
    }
    struct V { float4 p [[position]]; float4 c; };
    vertex V waveVertex(uint id [[vertex_id]], uint instance [[instance_id]], device const Column *data [[buffer(0)]], constant U &u [[buffer(1)]]) {
        uint x=instance%u.config.y, level=instance/u.config.y; Column c=data[x];
        float amplitude=c.levels[level]; if(amplitude<=.002f) amplitude=0;
        const float2 corners[6]={float2(-1,-1),float2(1,-1),float2(-1,1),float2(-1,1),float2(1,-1),float2(1,1)};
        float along=u.config.z ? u.geometry.y : u.geometry.x, across=u.config.z ? u.geometry.x : u.geometry.y;
        float dt=u.geometry.w/along*2.f, first=floor(u.geometry.z/dt);
        float base=round((first*dt-u.geometry.z)/u.geometry.w*along);
        float p=base+float(x)*2.f+corners[id].x, q=across*.5f+corners[id].y*amplitude*across*.5f;
        float2 pixel=u.config.z ? float2(q,p) : float2(p,q);
        V v; v.p=float4(pixel.x/u.geometry.x*2.f-1.f,1.f-pixel.y/u.geometry.y*2.f,0,1);
        v.c=level==0 ? c.c0 : level==1 ? c.c1 : c.c2;return v;
    }
    fragment float4 waveFragment(V in [[stage_in]]) { return in.c; }
    """
}
