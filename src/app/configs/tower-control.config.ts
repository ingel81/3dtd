/**
 * Manning a tower: the player sits in it and aims and fires it by hand, in
 * first person (docs/TOWER_CONTROL.md). The tower keeps its own rules (range,
 * sight, air and ground, fire rate, damage, turn speed); these numbers only
 * say where the eye sits and how generous a hit is.
 */
export const TOWER_CONTROL = {
  /** Eye above the tower's muzzle height (heightOffset + shootHeight), m */
  eyeUpM: 2,
  /** Eye behind the muzzle along the aim when looking level or up, m, so the guns are in view */
  eyeBackM: 1.6,
  /**
   * Eye in front of the muzzle when looking as far down as pitchMin, m. In
   * between it slides with the pitch, so looking down the guns fall behind
   * the view instead of filling it.
   */
  eyeForwardDownM: 1.8,
  /**
   * The eye stays at least this far over the top of the tower's model, m:
   * where the muzzle sits under a roof (the archer), muzzle + eyeUpM would
   * be inside it. Above the camera's 1 m near plane, so no roof is cut open.
   */
  eyeOverModelM: 1.5,
  /** Aim above the horizon the view allows, rad */
  pitchMax: (70 * Math.PI) / 180,
  /** Aim below the horizon the view allows, rad */
  pitchMin: (-60 * Math.PI) / 180,
  /** Mouse look, rad per pixel of pointer movement */
  lookRadPerPx: 0.0022,
  /** Field of view while the right button zooms, degrees; the camera's own otherwise */
  zoomFovDeg: 25,
  /**
   * The turret fires only this close to the aim, rad. Tighter than the
   * automatic fire's 15°: the player sees the crosshair, not the turret.
   */
  alignToleranceRad: (5 * Math.PI) / 180,
  /**
   * Hit radius around an enemy's aim point: its visual half height, at least
   * `hitRadiusMinM`, at most `hitRadiusMaxM`, plus `hitAssistM` so a shot
   * that just grazes the model still counts.
   */
  hitRadiusMinM: 0.6,
  hitRadiusMaxM: 4,
  hitAssistM: 0.4,
  /** A body along the route (the ooze) is thick: radius around its aim point, m */
  bodyHitRadiusM: 2.5,
  /**
   * Feedback cues (the kill gold) sound as from at least this far off while
   * the player sits in a tower, m: about where the camera hangs otherwise,
   * instead of at full volume a few metres over the kills
   */
  feedbackSoundMinDistanceM: 150,
  /** How long the hit marker stays on the crosshair, ms (wall clock) */
  hitMarkerMs: 160,
  /** How long the kill marker stays, ms (wall clock) */
  killMarkerMs: 420,
} as const;
