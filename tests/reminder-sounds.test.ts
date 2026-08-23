import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { REMINDER_SOUND_IDS } from "../src/shared/constants.ts";

interface WaveMetrics {
    duration: number;
    peak: number;
    rms: number;
}

function readPcmWaveMetrics(file: Buffer): WaveMetrics {
    assert.equal(file.toString("ascii", 0, 4), "RIFF");
    assert.equal(file.toString("ascii", 8, 12), "WAVE");

    let formatOffset = -1;
    let dataOffset = -1;
    let dataSize = 0;
    for (let offset = 12; offset + 8 <= file.length;) {
        const chunkId = file.toString("ascii", offset, offset + 4);
        const chunkSize = file.readUInt32LE(offset + 4);
        if (chunkId === "fmt ") formatOffset = offset + 8;
        if (chunkId === "data") {
            dataOffset = offset + 8;
            dataSize = chunkSize;
            break;
        }
        offset += 8 + chunkSize + (chunkSize % 2);
    }

    assert.ok(formatOffset >= 0, "WAV must contain a fmt chunk");
    assert.ok(dataOffset >= 0, "WAV must contain a data chunk");
    assert.equal(file.readUInt16LE(formatOffset), 1, "WAV must use uncompressed PCM");
    const channels = file.readUInt16LE(formatOffset + 2);
    const sampleRate = file.readUInt32LE(formatOffset + 4);
    const bitsPerSample = file.readUInt16LE(formatOffset + 14);
    assert.equal(bitsPerSample, 16, "WAV must use 16-bit samples");

    let peak = 0;
    let sumSquares = 0;
    const sampleCount = dataSize / 2;
    for (let offset = dataOffset; offset < dataOffset + dataSize; offset += 2) {
        const sample = file.readInt16LE(offset) / 32768;
        peak = Math.max(peak, Math.abs(sample));
        sumSquares += sample * sample;
    }

    return {
        duration: sampleCount / channels / sampleRate,
        peak,
        rms: Math.sqrt(sumSquares / sampleCount),
    };
}

test("提醒音效是短促、可听且互不相同的真实 PCM 音频", () => {
    // Regression: five one-second reminder assets were valid MP3 containers filled with silence.
    const hashes = new Set<string>();

    for (const soundId of REMINDER_SOUND_IDS) {
        const file = readFileSync(new URL(`../src/assets/sounds/${soundId}.wav`, import.meta.url));
        const metrics = readPcmWaveMetrics(file);
        hashes.add(createHash("sha256").update(file).digest("hex"));

        assert.ok(metrics.duration >= 0.75 && metrics.duration <= 1.1, `${soundId} should last about one second`);
        assert.ok(metrics.peak >= 0.08, `${soundId} should contain a clearly audible peak`);
        assert.ok(metrics.rms >= 0.01, `${soundId} should not be silent`);
    }

    assert.equal(hashes.size, REMINDER_SOUND_IDS.length, "each reminder option should use a distinct sound");
});
