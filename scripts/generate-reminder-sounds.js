import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SAMPLE_RATE = 22_050;
const DURATION_SECONDS = 1;
const OUTPUT_DIRECTORY = fileURLToPath(new URL("../src/assets/sounds/", import.meta.url));

const profiles = {
    chime: [
        {
            at: 0.02,
            decay: 0.3,
            frequencies: [
                [880, 1],
                [1320, 0.34],
                [1760, 0.16],
            ],
        },
        {
            at: 0.36,
            decay: 0.34,
            frequencies: [
                [1174.66, 1],
                [1761.99, 0.3],
                [2349.32, 0.12],
            ],
        },
    ],
    soft: [
        {
            at: 0.04,
            decay: 0.48,
            frequencies: [
                [523.25, 1],
                [659.25, 0.28],
                [1046.5, 0.1],
            ],
        },
    ],
    bell: [
        {
            at: 0.02,
            decay: 0.55,
            frequencies: [
                [659.25, 1],
                [1318.5, 0.42],
                [1727.24, 0.24],
                [2307.38, 0.12],
            ],
        },
    ],
    ping: [
        {
            at: 0.06,
            decay: 0.13,
            frequencies: [
                [1318.51, 1],
                [2637.02, 0.16],
            ],
        },
        {
            at: 0.42,
            decay: 0.14,
            frequencies: [
                [1567.98, 1],
                [3135.96, 0.14],
            ],
        },
    ],
    gentle: [
        {
            at: 0.03,
            decay: 0.4,
            frequencies: [
                [440, 1],
                [554.37, 0.24],
                [880, 0.08],
            ],
        },
        {
            at: 0.36,
            decay: 0.38,
            frequencies: [
                [523.25, 1],
                [659.25, 0.22],
                [1046.5, 0.07],
            ],
        },
    ],
};

function renderStrike(time, strike) {
    const localTime = time - strike.at;
    if (localTime < 0) return 0;

    const attack = Math.min(1, localTime / 0.006);
    const envelope = attack * Math.exp(-localTime / strike.decay);
    return strike.frequencies.reduce(
        (sample, [frequency, amplitude]) =>
            sample + Math.sin(2 * Math.PI * frequency * localTime) * amplitude * envelope,
        0,
    );
}

function renderProfile(strikes) {
    const sampleCount = SAMPLE_RATE * DURATION_SECONDS;
    const samples = new Float64Array(sampleCount);
    let peak = 0;

    for (let index = 0; index < sampleCount; index += 1) {
        const time = index / SAMPLE_RATE;
        const endingFade = Math.min(1, (DURATION_SECONDS - time) / 0.06);
        const sample = strikes.reduce((sum, strike) => sum + renderStrike(time, strike), 0) * endingFade;
        samples[index] = sample;
        peak = Math.max(peak, Math.abs(sample));
    }

    const scale = 0.52 / peak;
    return samples.map((sample) => sample * scale);
}

function encodePcmWave(samples) {
    const bytesPerSample = 2;
    const dataSize = samples.length * bytesPerSample;
    const file = Buffer.alloc(44 + dataSize);

    file.write("RIFF", 0);
    file.writeUInt32LE(36 + dataSize, 4);
    file.write("WAVE", 8);
    file.write("fmt ", 12);
    file.writeUInt32LE(16, 16);
    file.writeUInt16LE(1, 20);
    file.writeUInt16LE(1, 22);
    file.writeUInt32LE(SAMPLE_RATE, 24);
    file.writeUInt32LE(SAMPLE_RATE * bytesPerSample, 28);
    file.writeUInt16LE(bytesPerSample, 32);
    file.writeUInt16LE(16, 34);
    file.write("data", 36);
    file.writeUInt32LE(dataSize, 40);

    samples.forEach((sample, index) => {
        const pcm = Math.round(Math.max(-1, Math.min(1, sample)) * 32767);
        file.writeInt16LE(pcm, 44 + index * bytesPerSample);
    });
    return file;
}

mkdirSync(OUTPUT_DIRECTORY, { recursive: true });
for (const [soundId, strikes] of Object.entries(profiles)) {
    writeFileSync(`${OUTPUT_DIRECTORY}/${soundId}.wav`, encodePcmWave(renderProfile(strikes)));
}
