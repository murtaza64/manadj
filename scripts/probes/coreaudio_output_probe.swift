#!/usr/bin/env swift
// Read-only CoreAudio output capability probe (master-headroom 01).
// Reports float stream format and whether macOS exposes a scalar/mute
// control for each relevant output device. It never changes a property.

import CoreAudio
import Foundation

func propertySize(_ object: AudioObjectID, _ address: inout AudioObjectPropertyAddress) -> UInt32? {
    var size: UInt32 = 0
    return AudioObjectGetPropertyDataSize(object, &address, 0, nil, &size) == noErr ? size : nil
}

func values<T>(_ object: AudioObjectID, _ address: inout AudioObjectPropertyAddress, _: T.Type) -> [T]? {
    guard let size = propertySize(object, &address), size > 0 else { return nil }
    let count = Int(size) / MemoryLayout<T>.stride
    let pointer = UnsafeMutablePointer<T>.allocate(capacity: count)
    defer { pointer.deallocate() }
    var mutableSize = size
    guard AudioObjectGetPropertyData(object, &address, 0, nil, &mutableSize, pointer) == noErr else {
        return nil
    }
    return Array(UnsafeBufferPointer(start: pointer, count: count))
}

func stringProperty(_ object: AudioObjectID, _ selector: AudioObjectPropertySelector) -> String {
    var address = AudioObjectPropertyAddress(
        mSelector: selector,
        mScope: kAudioObjectPropertyScopeGlobal,
        mElement: kAudioObjectPropertyElementMain)
    var value: CFString? = nil
    var size = UInt32(MemoryLayout<CFString?>.size)
    let status = withUnsafeMutablePointer(to: &value) {
        AudioObjectGetPropertyData(object, &address, 0, nil, &size, $0)
    }
    return status == noErr ? (value as String? ?? "?") : "?"
}

func capability(
    _ device: AudioObjectID,
    selector: AudioObjectPropertySelector,
    element: AudioObjectPropertyElement
) -> String {
    var address = AudioObjectPropertyAddress(
        mSelector: selector,
        mScope: kAudioDevicePropertyScopeOutput,
        mElement: element)
    guard AudioObjectHasProperty(device, &address) else { return "absent" }
    var settable = DarwinBoolean(false)
    let status = AudioObjectIsPropertySettable(device, &address, &settable)
    return status == noErr ? (settable.boolValue ? "settable" : "read-only") : "query-error"
}

var devicesAddress = AudioObjectPropertyAddress(
    mSelector: kAudioHardwarePropertyDevices,
    mScope: kAudioObjectPropertyScopeGlobal,
    mElement: kAudioObjectPropertyElementMain)
let devices = values(AudioObjectID(kAudioObjectSystemObject), &devicesAddress, AudioObjectID.self) ?? []

for device in devices {
    let name = stringProperty(device, kAudioObjectPropertyName)
    guard name.contains("GRV6") || name.contains("Speakers") || name.contains("Aggregate") else { continue }
    var streamsAddress = AudioObjectPropertyAddress(
        mSelector: kAudioDevicePropertyStreams,
        mScope: kAudioDevicePropertyScopeOutput,
        mElement: kAudioObjectPropertyElementMain)
    let streams = values(device, &streamsAddress, AudioObjectID.self) ?? []
    print("=== \(name) (id \(device)) ===")
    for stream in streams {
        var formatAddress = AudioObjectPropertyAddress(
            mSelector: kAudioStreamPropertyVirtualFormat,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain)
        if let format = values(stream, &formatAddress, AudioStreamBasicDescription.self)?.first {
            print("stream \(stream): rate=\(Int(format.mSampleRate)) channels=\(format.mChannelsPerFrame) format=0x\(String(format.mFormatID, radix: 16)) flags=0x\(String(format.mFormatFlags, radix: 16)) bits=\(format.mBitsPerChannel)")
        }
    }
    print("master volume: \(capability(device, selector: kAudioDevicePropertyVolumeScalar, element: kAudioObjectPropertyElementMain))")
    print("channel 1 volume: \(capability(device, selector: kAudioDevicePropertyVolumeScalar, element: 1))")
    print("mute: \(capability(device, selector: kAudioDevicePropertyMute, element: kAudioObjectPropertyElementMain))")
    print("")
}
