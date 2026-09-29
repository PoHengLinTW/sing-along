import { getAudioController } from '../controller';
import { clearLevel, type createLevelStore, feedLevel, levelStore } from './levelStore';
import { browserRecorderDeps, type LevelMessage, Recorder } from './recorder';

interface MonitorRecorder {
  open(deviceId: string | null): Promise<void>;
  close(): void;
}

interface MonitorDeps {
  createRecorder: (onLevel: (l: LevelMessage) => void) => MonitorRecorder;
  levels: ReturnType<typeof createLevelStore>;
}

/** "Check input level": the mic is open and metered, but nothing is captured or stored. */
export class InputMonitor {
  private recorder: MonitorRecorder | null = null;
  private starting: Promise<void> | null = null;

  constructor(private deps: MonitorDeps) {}

  start(deviceId: string | null): Promise<void> {
    if (this.recorder) return Promise.resolve();
    this.starting ??= this.open(deviceId).finally(() => {
      this.starting = null;
    });
    return this.starting;
  }

  private async open(deviceId: string | null): Promise<void> {
    const recorder = this.deps.createRecorder((l) => feedLevel(this.deps.levels, l));
    await recorder.open(deviceId);
    this.recorder = recorder;
    this.deps.levels.setState({ monitoring: true });
  }

  stop(): void {
    if (!this.recorder) return;
    this.recorder.close();
    this.recorder = null;
    clearLevel(this.deps.levels);
    this.deps.levels.setState({ monitoring: false });
  }
}

let shared: InputMonitor | null = null;
export function getInputMonitor(): InputMonitor {
  shared ??= new InputMonitor({
    createRecorder: (onLevel) => {
      const ctx = getAudioController().engine.ensureContext();
      void ctx.resume();
      return new Recorder(browserRecorderDeps(ctx), undefined, onLevel);
    },
    levels: levelStore,
  });
  return shared;
}
