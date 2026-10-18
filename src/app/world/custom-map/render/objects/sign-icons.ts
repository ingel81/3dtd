/**
 * The pictograms of signs (MapObject.sign.icon): drawn by hand in a 64 x 64
 * box with a few strokes and fills, the way a sign painter cuts them from
 * sheet metal: bold, rounded, no fine detail, no brand's mark. sign-text.ts
 * draws them into its atlas in the ink of the sign; the fill and stroke
 * colour is set before a pictogram is drawn, every pictogram only shapes.
 */

/** Draws one pictogram into the 64 x 64 box at the context's origin */
export type SignIconDraw = (g: CanvasRenderingContext2D) => void;

const W = 6;

function line(g: CanvasRenderingContext2D, pts: readonly number[], width = W): void {
  g.lineWidth = width;
  g.beginPath();
  g.moveTo(pts[0], pts[1]);
  for (let k = 2; k < pts.length; k += 2) g.lineTo(pts[k], pts[k + 1]);
  g.stroke();
}

function shape(g: CanvasRenderingContext2D, pts: readonly number[]): void {
  g.beginPath();
  g.moveTo(pts[0], pts[1]);
  for (let k = 2; k < pts.length; k += 2) g.lineTo(pts[k], pts[k + 1]);
  g.closePath();
  g.fill();
}

function disc(g: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fill();
}

function ring(g: CanvasRenderingContext2D, x: number, y: number, r: number, width = W, from = 0, to = Math.PI * 2): void {
  g.lineWidth = width;
  g.beginPath();
  g.arc(x, y, r, from, to);
  g.stroke();
}

function rounded(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  g.beginPath();
  g.roundRect(x, y, w, h, r);
  g.fill();
}

/** Cuts a shape out of what is drawn (the hole of a cup's handle, the eye of a needle) */
function cut(g: CanvasRenderingContext2D, draw: () => void): void {
  const op = g.globalCompositeOperation;
  g.globalCompositeOperation = 'destination-out';
  draw();
  g.globalCompositeOperation = op;
}

export const SIGN_ICONS: Readonly<Record<string, SignIconDraw>> = {
  /** A pretzel: the bakers' sign */
  pretzel: (g) => {
    g.lineWidth = 7;
    // The belly round the bottom, the two lobes up to the knot in the middle
    g.beginPath();
    g.moveTo(32, 28);
    g.bezierCurveTo(26, 8, 4, 8, 6, 30);
    g.bezierCurveTo(8, 50, 22, 56, 32, 56);
    g.bezierCurveTo(42, 56, 56, 50, 58, 30);
    g.bezierCurveTo(60, 8, 38, 8, 32, 28);
    g.stroke();
    // The arms twisted once in the knot, their ends laid on the belly
    line(g, [24, 22, 38, 34, 44, 50], 7);
    line(g, [40, 22, 26, 34, 20, 50], 7);
  },
  /** A tiered cake with a candle */
  cake: (g) => {
    rounded(g, 8, 38, 48, 16, 3);
    rounded(g, 14, 24, 36, 13, 3);
    line(g, [32, 22, 32, 12], 4);
    disc(g, 32, 9, 3.5);
  },
  /** A sausage hanging beside a cleaver */
  butcher: (g) => {
    // A leg of ham with its bone
    g.beginPath();
    g.moveTo(10, 30);
    g.bezierCurveTo(8, 12, 30, 4, 40, 16);
    g.lineTo(46, 26);
    g.bezierCurveTo(40, 40, 28, 50, 18, 46);
    g.bezierCurveTo(12, 44, 10, 38, 10, 30);
    g.fill();
    line(g, [44, 28, 54, 40], 6);
    disc(g, 56, 38, 5);
    disc(g, 52, 44, 5);
    cut(g, () => {
      g.beginPath();
      g.ellipse(24, 26, 6, 9, 0.6, 0, Math.PI * 2);
      g.fill();
    });
  },
  /** A cup on a saucer with steam */
  cup: (g) => {
    shape(g, [12, 28, 44, 28, 41, 48, 15, 48]);
    ring(g, 46, 36, 7, 5, -Math.PI / 2, Math.PI / 2);
    line(g, [6, 54, 50, 54], 5);
    line(g, [22, 22, 24, 16, 22, 10], 3);
    line(g, [32, 22, 34, 16, 32, 10], 3);
  },
  /** Fork and knife */
  cutlery: (g) => {
    line(g, [20, 8, 20, 56], 6);
    line(g, [13, 8, 13, 24, 27, 24, 27, 8], 4);
    g.beginPath();
    g.moveTo(40, 56);
    g.lineTo(40, 8);
    g.bezierCurveTo(52, 14, 52, 30, 44, 34);
    g.lineTo(44, 56);
    g.closePath();
    g.fill();
  },
  /** A beer mug with a head of foam */
  beer: (g) => {
    rounded(g, 14, 18, 28, 38, 3);
    ring(g, 44, 36, 9, 6, -Math.PI / 2, Math.PI / 2);
    disc(g, 18, 16, 7);
    disc(g, 28, 13, 8);
    disc(g, 38, 16, 7);
    cut(g, () => {
      line(g, [23, 28, 23, 50], 3);
      line(g, [33, 28, 33, 50], 3);
    });
  },
  /** A cocktail glass */
  cocktail: (g) => {
    shape(g, [8, 12, 56, 12, 32, 36]);
    line(g, [32, 34, 32, 52], 5);
    line(g, [20, 54, 44, 54], 5);
    line(g, [40, 6, 48, 18], 3);
  },
  /** A glass of wine */
  wine: (g) => {
    g.beginPath();
    g.moveTo(18, 8);
    g.lineTo(46, 8);
    g.bezierCurveTo(48, 28, 40, 36, 32, 36);
    g.bezierCurveTo(24, 36, 16, 28, 18, 8);
    g.fill();
    line(g, [32, 34, 32, 52], 5);
    line(g, [20, 54, 44, 54], 5);
  },
  /** An ice cream cone with two scoops */
  icecream: (g) => {
    shape(g, [18, 30, 46, 30, 32, 60]);
    disc(g, 25, 24, 9);
    disc(g, 39, 24, 9);
    disc(g, 32, 13, 9);
  },
  /** A bun with a filling: snacks */
  snack: (g) => {
    g.beginPath();
    g.moveTo(8, 30);
    g.bezierCurveTo(8, 10, 56, 10, 56, 30);
    g.closePath();
    g.fill();
    line(g, [8, 37, 56, 37], 5);
    rounded(g, 8, 43, 48, 11, 5);
  },
  /** A shopping basket */
  basket: (g) => {
    shape(g, [6, 26, 58, 26, 52, 54, 12, 54]);
    ring(g, 32, 26, 16, 5, Math.PI, Math.PI * 2);
    cut(g, () => {
      line(g, [22, 32, 22, 48], 3);
      line(g, [32, 32, 32, 48], 3);
      line(g, [42, 32, 42, 48], 3);
    });
  },
  /** A folded newspaper */
  newspaper: (g) => {
    rounded(g, 10, 10, 44, 44, 3);
    cut(g, () => {
      g.fillRect(16, 16, 32, 7);
      g.fillRect(16, 28, 14, 3);
      g.fillRect(16, 35, 14, 3);
      g.fillRect(16, 42, 14, 3);
      g.fillRect(34, 28, 14, 17);
    });
  },
  /** A coat hanger */
  hanger: (g) => {
    ring(g, 32, 14, 6, 4, Math.PI, Math.PI * 2.4);
    line(g, [32, 20, 32, 24], 4);
    line(g, [32, 24, 6, 44, 58, 44, 32, 24], 5);
  },
  /** A shoe seen from the side */
  shoe: (g) => {
    g.beginPath();
    g.moveTo(8, 50);
    g.lineTo(8, 18);
    g.lineTo(24, 18);
    g.bezierCurveTo(26, 30, 34, 32, 44, 34);
    g.bezierCurveTo(56, 36, 58, 44, 58, 50);
    g.closePath();
    g.fill();
    line(g, [8, 54, 58, 54], 4);
  },
  /** Open scissors */
  scissors: (g) => {
    ring(g, 16, 46, 8, 5);
    ring(g, 48, 46, 8, 5);
    line(g, [21, 40, 46, 8], 6);
    line(g, [43, 40, 18, 8], 6);
  },
  /** A cross: pharmacy, help */
  cross: (g) => {
    rounded(g, 24, 6, 16, 52, 2);
    rounded(g, 6, 24, 52, 16, 2);
  },
  /** A cross in a ring: a doctor's practice */
  doctor: (g) => {
    ring(g, 32, 32, 24, 5);
    rounded(g, 27, 16, 10, 32, 1);
    rounded(g, 16, 27, 32, 10, 1);
  },
  /** A tooth */
  tooth: (g) => {
    g.beginPath();
    g.moveTo(14, 12);
    g.bezierCurveTo(22, 6, 26, 12, 32, 12);
    g.bezierCurveTo(38, 12, 42, 6, 50, 12);
    g.bezierCurveTo(58, 20, 50, 34, 48, 44);
    g.bezierCurveTo(46, 56, 40, 58, 38, 48);
    g.lineTo(34, 36);
    g.lineTo(30, 36);
    g.lineTo(26, 48);
    g.bezierCurveTo(24, 58, 18, 56, 16, 44);
    g.bezierCurveTo(14, 34, 6, 20, 14, 12);
    g.fill();
  },
  /** A bottle with a label: the chemist's */
  bottle: (g) => {
    rounded(g, 26, 6, 12, 10, 2);
    g.beginPath();
    g.moveTo(26, 16);
    g.lineTo(38, 16);
    g.lineTo(46, 26);
    g.lineTo(46, 56);
    g.lineTo(18, 56);
    g.lineTo(18, 26);
    g.closePath();
    g.fill();
    cut(g, () => g.fillRect(22, 32, 20, 12));
  },
  /** A pair of glasses */
  glasses: (g) => {
    ring(g, 18, 36, 11, 5);
    ring(g, 46, 36, 11, 5);
    line(g, [28, 34, 36, 34], 4);
    line(g, [7, 34, 4, 22], 4);
    line(g, [57, 34, 60, 22], 4);
  },
  /** A ring with a stone */
  ring: (g) => {
    ring(g, 32, 40, 15, 6);
    shape(g, [24, 18, 32, 8, 40, 18, 32, 26]);
  },
  /** An open book */
  book: (g) => {
    shape(g, [6, 14, 30, 18, 30, 54, 6, 50]);
    shape(g, [34, 18, 58, 14, 58, 50, 34, 54]);
  },
  /** A flower on its stem with a leaf */
  flower: (g) => {
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2;
      disc(g, 32 + Math.cos(a) * 9, 20 + Math.sin(a) * 9, 7);
    }
    cut(g, () => disc(g, 32, 20, 4));
    line(g, [32, 30, 32, 58], 4);
    g.beginPath();
    g.ellipse(42, 46, 9, 4, -0.6, 0, Math.PI * 2);
    g.fill();
  },
  /** A coin with a stroke through: money */
  coin: (g) => {
    ring(g, 32, 32, 22, 6);
    ring(g, 34, 32, 10, 5, 0.7, Math.PI * 2 - 0.7);
    line(g, [18, 28, 36, 28], 4);
    line(g, [18, 36, 36, 36], 4);
  },
  /** An envelope */
  envelope: (g) => {
    rounded(g, 6, 14, 52, 36, 3);
    cut(g, () => line(g, [10, 18, 32, 36, 54, 18], 4));
  },
  /** A bed */
  bed: (g) => {
    line(g, [8, 14, 8, 54], 6);
    line(g, [56, 34, 56, 54], 6);
    rounded(g, 8, 36, 48, 10, 2);
    disc(g, 18, 29, 6);
    rounded(g, 26, 26, 28, 9, 3);
  },
  /** An open-end spanner */
  wrench: (g) => {
    line(g, [16, 48, 42, 22], 8);
    disc(g, 46, 18, 12);
    disc(g, 14, 50, 7);
    cut(g, () => shape(g, [44, 6, 58, 6, 58, 20, 48, 22]));
  },
  /** A bicycle */
  bicycle: (g) => {
    ring(g, 14, 42, 10, 4);
    ring(g, 50, 42, 10, 4);
    line(g, [14, 42, 26, 24, 42, 24, 50, 42], 4);
    line(g, [26, 24, 34, 42, 42, 24], 4);
    line(g, [24, 18, 30, 18], 4);
    line(g, [40, 18, 46, 16], 4);
  },
  /** A plug with its cable: electrics, phones */
  plug: (g) => {
    rounded(g, 18, 22, 28, 22, 4);
    line(g, [26, 8, 26, 22], 5);
    line(g, [38, 8, 38, 22], 5);
    line(g, [32, 44, 32, 52, 46, 58], 5);
  },
  /** A wrapped present */
  gift: (g) => {
    rounded(g, 10, 28, 44, 28, 2);
    rounded(g, 6, 20, 52, 9, 2);
    cut(g, () => g.fillRect(29, 20, 6, 36));
    ring(g, 24, 14, 6, 4);
    ring(g, 40, 14, 6, 4);
  },
  /** A pump nozzle at its column */
  fuel: (g) => {
    rounded(g, 10, 10, 26, 46, 3);
    cut(g, () => g.fillRect(15, 15, 16, 10));
    line(g, [36, 18, 48, 18, 52, 26, 52, 46, 46, 46, 46, 34], 4);
  },
  /** Columns under a pediment: museum, hall */
  columns: (g) => {
    shape(g, [6, 20, 32, 6, 58, 20]);
    for (const x of [12, 25, 39, 52]) g.fillRect(x - 3, 24, 6, 24);
    g.fillRect(6, 50, 52, 6);
  },
  /** A briefcase: an office */
  briefcase: (g) => {
    rounded(g, 6, 20, 52, 34, 4);
    ring(g, 32, 20, 9, 5, Math.PI, Math.PI * 2);
    cut(g, () => g.fillRect(6, 34, 52, 3));
  },
  /** An apple with a leaf: greengrocer */
  apple: (g) => {
    disc(g, 24, 38, 16);
    disc(g, 40, 38, 16);
    line(g, [32, 22, 34, 10], 4);
    g.beginPath();
    g.ellipse(42, 12, 8, 4, -0.5, 0, Math.PI * 2);
    g.fill();
  },
  /** A wedge of cheese: delicatessen */
  cheese: (g) => {
    shape(g, [6, 40, 52, 18, 58, 26, 58, 52, 6, 52]);
    cut(g, () => {
      disc(g, 22, 46, 4);
      disc(g, 42, 38, 5);
    });
  },
  /** A pipe with smoke: tobacco */
  pipe: (g) => {
    g.lineWidth = 6;
    g.beginPath();
    g.moveTo(4, 24);
    g.bezierCurveTo(20, 26, 28, 34, 34, 38);
    g.stroke();
    g.beginPath();
    g.moveTo(30, 26);
    g.lineTo(54, 26);
    g.lineTo(52, 44);
    g.bezierCurveTo(50, 54, 34, 54, 32, 44);
    g.closePath();
    g.fill();
    line(g, [42, 20, 46, 13, 42, 6], 3);
  },
  /** A picture in a frame: gallery */
  frame: (g) => {
    g.lineWidth = 6;
    g.strokeRect(8, 10, 48, 44);
    shape(g, [14, 48, 28, 30, 36, 40, 42, 34, 50, 48]);
    disc(g, 22, 22, 4);
  },
  /** A shopping bag: any shop */
  bag: (g) => {
    shape(g, [12, 22, 52, 22, 56, 58, 8, 58]);
    ring(g, 32, 22, 10, 4, Math.PI, Math.PI * 2);
  },
  /** A key: hardware, locksmith */
  key: (g) => {
    ring(g, 18, 22, 10, 6);
    line(g, [25, 29, 52, 56], 6);
    line(g, [44, 48, 50, 42], 5);
    line(g, [50, 54, 56, 48], 5);
  },
};

/** Whether `id` names a pictogram */
export function isSignIcon(id: string): boolean {
  return Object.prototype.hasOwnProperty.call(SIGN_ICONS, id);
}
