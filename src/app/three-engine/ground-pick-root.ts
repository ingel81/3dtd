import { Group, type Intersection, type Object3D, type Raycaster } from 'three';
import { raycastStats } from '../utils/raycast-stats';

/**
 * GroundPickRoot: was die GlobeControls als ihre Szene sehen, nur der Boden.
 *
 * Die Controls raycasten gegen ihre Szene, pro Frame den Punkt unter der Kamera
 * (Mindestabstand `cameraRadius`), beim Zoomen den Punkt unter dem Zeiger (Ziel
 * und Stopp `minDistance` davor), beim Ziehen und Drehen den Pivot. three.js
 * prüft dabei `visible` nicht. Mit der ganzen Szene trafen die Strahlen auch die
 * versteckten Reichweiten-Scheiben der Tower, die 1,5 m über dem Boden über
 * Dächer und Straßen gespannt sind, dazu Route-Linien, Ringe und Tower-Modelle.
 * Entlang der Route zoomte die Kamera deshalb auf Punkte über der Straße, hielt
 * davor an und schob die Welt beim Ziehen langsamer als den Zeiger.
 *
 * Die Wurzel hängt ohne Transform in der Szene, damit das Pivot-Mesh, das die
 * Controls hier einhängen, an seiner Weltposition gezeichnet wird. Strahlen
 * beantwortet sie nur mit dem Boden und geht nicht in die eigenen Kinder.
 * Hängt der Boden nicht in der Szene (Tiles per Debug ausgeblendet), trifft
 * nichts und die Controls nehmen ihren Rückfall, das Ellipsoid.
 */
export class GroundPickRoot extends Group {
  constructor(private readonly ground: Object3D) {
    super();
    this.name = 'GroundPickRoot';
  }

  override raycast(raycaster: Raycaster, intersects: Intersection[]): boolean {
    if (this.ground.parent) {
      // In `__raycastStats()` unter `cameraControls` statt `unscoped`
      const scope = raycastStats.enter('cameraControls');
      try {
        raycaster.intersectObject(this.ground, true, intersects);
      } finally {
        raycastStats.exit(scope);
      }
    }
    // false: three soll nicht in die Kinder (das Pivot-Mesh) weitergehen
    return false;
  }
}
