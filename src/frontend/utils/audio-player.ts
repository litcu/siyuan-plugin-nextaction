// src/frontend/utils/audio-player.ts
import type { ReminderSoundId } from "../../shared/constants";

const audioCache: Map<string, HTMLAudioElement> = new Map();
let autoplayUnlocked = false;

function getAudioUrl(soundId: ReminderSoundId): string {
    const map: Record<string, string> = {
        chime: new URL("../../assets/sounds/chime.mp3", import.meta.url).href,
        soft: new URL("../../assets/sounds/soft.mp3", import.meta.url).href,
        bell: new URL("../../assets/sounds/bell.mp3", import.meta.url).href,
        ping: new URL("../../assets/sounds/ping.mp3", import.meta.url).href,
        gentle: new URL("../../assets/sounds/gentle.mp3", import.meta.url).href,
    };
    return map[soundId] || map.chime;
}

export function unlockAutoplay(): void {
    autoplayUnlocked = true;
}

export async function playSound(soundId: ReminderSoundId): Promise<void> {
    try {
        let audio = audioCache.get(soundId);
        if (!audio) {
            audio = new Audio(getAudioUrl(soundId));
            audioCache.set(soundId, audio);
        }
        audio.currentTime = 0;
        await audio.play();
        autoplayUnlocked = true;
    } catch {
        // Autoplay blocked or other audio error — silent fallback
    }
}

export function isAutoplayUnlocked(): boolean {
    return autoplayUnlocked;
}
