export class Vector3 {
  constructor(
    public x = 0,
    public y = 0,
    public z = 0
  ) {}
}

export class AudioLoader {
  load(_url: string, onLoad?: (buffer: unknown) => void) {
    if (onLoad) onLoad({});
  }
}

export class AudioListener {}

export class Audio {
  constructor(_listener: unknown) {}
  setBuffer() { return this; }
  setLoop() { return this; }
  setVolume() { return this; }
  play() { return this; }
  stop() { return this; }
  pause() { return this; }
  isPlaying = false;
}

export default { Vector3, AudioLoader, AudioListener, Audio };
