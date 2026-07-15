// Assert a device's CoreAudio output channel labels (four-deck 33).
//
// Chromium collapses output devices whose preferred-channel-layout labels
// are all kAudioChannelLabel_Unknown to stereo (see issue 32 / ADR 0017
// amendment), so multichannel Web Audio on such devices depends on named
// labels in the device's HAL settings. Firmware ships some controllers
// (DDJ-GRV6) with Unknown labels; this helper writes named ones.
//
// Idempotent: reads first, writes only when the labels differ. The write
// persists in per-device macOS audio settings across replug/reboot
// (hardware-verified 2026-07-15).
//
// Usage: swift assert-channel-labels.swift <deviceNameSubstring> <label,label,...>
//   labels are numeric AudioChannelLabel values, e.g. "1,2,5,6" = L,R,LS,RS.
// Exit 0: asserted / already correct / device absent (boot-time no-op).
// Exit 1: bad invocation or a CoreAudio failure worth logging.

import CoreAudio
import Foundation

let args = CommandLine.arguments
guard args.count == 3, let wanted = Optional(args[2].split(separator: ",").compactMap({ UInt32($0) })),
      !wanted.isEmpty
else {
    FileHandle.standardError.write("usage: assert-channel-labels.swift <nameSubstr> <label,...>\n".data(using: .utf8)!)
    exit(1)
}
let nameSubstr = args[1]

func getDeviceName(_ dev: AudioObjectID) -> String {
    var addr = AudioObjectPropertyAddress(mSelector: kAudioObjectPropertyName,
                                          mScope: kAudioObjectPropertyScopeGlobal,
                                          mElement: kAudioObjectPropertyElementMain)
    var size = UInt32(MemoryLayout<CFString?>.size)
    var str: CFString? = nil
    let err = withUnsafeMutablePointer(to: &str) { ptr -> OSStatus in
        AudioObjectGetPropertyData(dev, &addr, 0, nil, &size, ptr)
    }
    return err == noErr ? (str as String? ?? "") : ""
}

// Enumerate devices.
var devicesAddr = AudioObjectPropertyAddress(mSelector: kAudioHardwarePropertyDevices,
                                             mScope: kAudioObjectPropertyScopeGlobal,
                                             mElement: kAudioObjectPropertyElementMain)
var size: UInt32 = 0
guard AudioObjectGetPropertyDataSize(AudioObjectID(kAudioObjectSystemObject), &devicesAddr, 0, nil, &size) == noErr
else { FileHandle.standardError.write("device enumeration failed\n".data(using: .utf8)!); exit(1) }
var devices = [AudioObjectID](repeating: 0, count: Int(size) / MemoryLayout<AudioObjectID>.size)
guard AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &devicesAddr, 0, nil, &size, &devices) == noErr
else { FileHandle.standardError.write("device enumeration failed\n".data(using: .utf8)!); exit(1) }

guard let dev = devices.first(where: { getDeviceName($0).contains(nameSubstr) }) else {
    print("assert-channel-labels: \(nameSubstr) not connected; nothing to do")
    exit(0)
}
let devName = getDeviceName(dev)

// Read the current output-scope preferred channel layout.
var layoutAddr = AudioObjectPropertyAddress(mSelector: kAudioDevicePropertyPreferredChannelLayout,
                                            mScope: kAudioDevicePropertyScopeOutput,
                                            mElement: kAudioObjectPropertyElementMain)
var lsize: UInt32 = 0
guard AudioObjectGetPropertyDataSize(dev, &layoutAddr, 0, nil, &lsize) == noErr, lsize > 0 else {
    FileHandle.standardError.write("\(devName): no preferred channel layout property\n".data(using: .utf8)!)
    exit(1)
}
let ptr = UnsafeMutableRawPointer.allocate(byteCount: Int(lsize), alignment: 8)
defer { ptr.deallocate() }
guard AudioObjectGetPropertyData(dev, &layoutAddr, 0, nil, &lsize, ptr) == noErr else {
    FileHandle.standardError.write("\(devName): layout read failed\n".data(using: .utf8)!)
    exit(1)
}
let layout = ptr.assumingMemoryBound(to: AudioChannelLayout.self)
let n = Int(layout.pointee.mNumberChannelDescriptions)
guard wanted.count == n else {
    FileHandle.standardError.write(
        "\(devName): has \(n) output channel descriptions, got \(wanted.count) labels — Mapping stale?\n"
            .data(using: .utf8)!)
    exit(1)
}

let descOffset = MemoryLayout<AudioChannelLayout>.offset(of: \AudioChannelLayout.mChannelDescriptions)!
let descPtr = ptr.advanced(by: descOffset).assumingMemoryBound(to: AudioChannelDescription.self)
let current = (0..<n).map { descPtr[$0].mChannelLabel }
if layout.pointee.mChannelLayoutTag == kAudioChannelLayoutTag_UseChannelDescriptions, current == wanted {
    print("assert-channel-labels: \(devName) labels already \(wanted); no write")
    exit(0)
}

// Write the wanted labels.
layout.pointee.mChannelLayoutTag = kAudioChannelLayoutTag_UseChannelDescriptions
layout.pointee.mChannelBitmap = AudioChannelBitmap(rawValue: 0)
for i in 0..<n {
    descPtr[i].mChannelLabel = wanted[i]
    descPtr[i].mChannelFlags = AudioChannelFlags(rawValue: 0)
    descPtr[i].mCoordinates = (0, 0, 0)
}
let err = AudioObjectSetPropertyData(dev, &layoutAddr, 0, nil, lsize, ptr)
guard err == noErr else {
    FileHandle.standardError.write("\(devName): layout write failed (OSStatus \(err))\n".data(using: .utf8)!)
    exit(1)
}
print("assert-channel-labels: \(devName) labels \(current) -> \(wanted)")
