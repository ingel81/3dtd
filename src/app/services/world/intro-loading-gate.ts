import {
  INTRO_GATE_SAMPLES_PER_FRAME,
  INTRO_GATE_TIMEOUT_MS,
  flightGateMeta,
  flightGateOpen,
} from '../../utils/flight-gate';
import { cameraTimeline } from '../../utils/camera-timeline';
import type { EngineInitializationService } from '../infrastructure/engine-initialization.service';
import type { HeightUpdateService } from './height-update.service';
import type { PathAndRouteService } from './path-route.service';
import type { IntroCameraFlightService } from './intro-camera-flight.service';

/** What IntroLoadingGate needs; VisualizationFacadeService passes its services. */
export interface IntroLoadingGateDeps {
  engineInit: Pick<
    EngineInitializationService,
    'tilesLoading' | 'osmLoading' | 'getFirstTilesLoadedAt' | 'setStepDone' | 'setStepCurrent' | 'updateStepMeta'
  >;
  heightUpdate: Pick<HeightUpdateService, 'heightsLoading'>;
  pathRoute: Pick<PathAndRouteService, 'getCachedPaths'>;
  introFlight: Pick<IntroCameraFlightService, 'prepare' | 'readiness' | 'prepareTick'>;
  /** Ask again whether loading is done (VisualizationFacadeService.checkAllLoaded). */
  recheck: () => void;
}

/**
 * Intro boot gate (utils/flight-gate.ts). Once tiles, streets and heights
 * are done, the loading screen stays up until the intro flight has reliable
 * heights along INTRO_GATE_MIN_READY of its route, or until
 * INTRO_GATE_TIMEOUT_MS after the first tiles arrived. Meanwhile it samples
 * the route every frame; the route corridor streams fine tiles whatever
 * the camera shows, so the share grows while the screen is up.
 */
export class IntroLoadingGate {
  /** Pending frame, deadline, passed. */
  private introGateRaf: number | null = null;
  private introGateDeadline: number | null = null;
  private introGateDone = false;

  constructor(private readonly deps: IntroLoadingGateDeps) {}

  /**
   * @returns true while holding the loading screen
   */
  hold(): boolean {
    const { engineInit, introFlight } = this.deps;
    if (this.introGateDone) return false;
    if (engineInit.tilesLoading() || engineInit.osmLoading() || this.deps.heightUpdate.heightsLoading()) {
      return false;
    }

    if (this.introGateDeadline === null) {
      const paths = this.deps.pathRoute.getCachedPaths();
      if (paths.size === 0 || !introFlight.prepare(paths)) {
        this.introGateDone = true;
        void engineInit.setStepDone('flight');
        return false;
      }
      this.introGateDeadline = (engineInit.getFirstTilesLoadedAt() ?? performance.now()) + INTRO_GATE_TIMEOUT_MS;
      void engineInit.setStepDone('tiles');
      void engineInit.setStepCurrent('flight');
    }

    const readiness = introFlight.readiness();
    if (flightGateOpen(readiness, performance.now(), this.introGateDeadline)) {
      cameraTimeline.record('intro.gateOpen', { readiness: Math.round(readiness * 100) / 100 });
      this.introGateDone = true;
      void engineInit.setStepDone('flight', flightGateMeta(readiness));
      return false;
    }

    engineInit.updateStepMeta('flight', flightGateMeta(readiness));
    if (this.introGateRaf === null) {
      this.introGateRaf = requestAnimationFrame(() => {
        this.introGateRaf = null;
        introFlight.prepareTick(INTRO_GATE_SAMPLES_PER_FRAME);
        this.deps.recheck();
      });
    }
    return true;
  }

  /** Cancel a pending frame and arm the gate again for the next load. */
  dispose(): void {
    if (this.introGateRaf !== null) {
      cancelAnimationFrame(this.introGateRaf);
      this.introGateRaf = null;
    }
    this.introGateDeadline = null;
    this.introGateDone = false;
  }
}
