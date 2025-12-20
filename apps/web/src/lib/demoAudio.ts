/**
 * Demo audio files available from the public/audio folder.
 * These can be loaded without requiring the user to select a local file.
 */

export interface DemoAudioFile {
  /** Display name shown in the UI */
  name: string;
  /** Path relative to /public (will be fetched from this URL) */
  path: string;
  /** Optional description or category */
  description?: string;
}

export const DEMO_AUDIO_FILES: DemoAudioFile[] = [
  {
    name: "Parseq Demo (140 BPM)",
    path: "/audio/parseq-demo-140bpm.mp3",
    description: "Short demo track",
  },
  {
    name: "Four-Four Short",
    path: "/audio/Four-Four-short.mp3",
    description: "4/4 time sample",
  },
  {
    name: "Parseq Tutorial 3",
    path: "/audio/ParseqTut3-full.mp3",
    description: "Tutorial audio",
  },
  {
    name: "ArtThing",
    path: "/audio/ArtThing.mp3",
    description: "Music sample",
  },
  {
    name: "Benz",
    path: "/audio/benz.mp3",
    description: "Music sample",
  },
  {
    name: "Super",
    path: "/audio/super.mp3",
    description: "Music sample",
  },
  {
    name: "Dramatisons",
    path: "/audio/rewbs - dramatisons (Hi-Q).mp3",
    description: "Full track",
  },
  {
    name: "Spongiform Brain Diseases",
    path: "/audio/rewbs - Spongiform brain diseases (CJD).mp3",
    description: "Full track",
  },
  {
    name: "Frequency Test",
    path: "/audio/Freq-test.wav",
    description: "Audio test file",
  },
];
