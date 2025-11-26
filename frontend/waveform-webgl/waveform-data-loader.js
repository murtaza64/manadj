export async function loadWaveformData(trackId) {
    const response = await fetch(`http://localhost:8000/api/waveforms/${trackId}`);
    const data = await response.json();

    // Convert JSON arrays to Float32Arrays and normalize 0-1
    const normalize = (arr) => {
        const max = Math.max(...arr);
        return new Float32Array(arr.map(v => v / max));
    };

    return {
        low: normalize(data.data.bands.low),
        mid: normalize(data.data.bands.mid),
        high: normalize(data.data.bands.high),
        duration: data.data.duration
    };
}
