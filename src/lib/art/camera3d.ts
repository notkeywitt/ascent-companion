/**
 * A small orbit camera for the 3D Job Flock: it looks at the centre of the
 * flock's cube from a distance, turned by `yaw` (around the vertical) and
 * tilted by `pitch`. `project` turns a world point into canvas pixels plus a
 * depth; `ray` turns a canvas pixel back into a line through the world, for
 * the pointer-as-hawk. Pure: no DOM.
 */
import { SIDE } from "./flock3d";

export interface Projected {
  sx: number;
  sy: number;
  /** Distance in front of the camera; bigger is further. */
  depth: number;
  /** Pixels per world unit at that depth. */
  scale: number;
}

export class Camera3D {
  yaw = 0.6;
  pitch = 0.32;
  /** Camera distance from the cube's centre, in world units. */
  dist = SIDE * 2.3;
  w = 800;
  h = 500;

  /** Focal length in pixels: the cube fills the frame (owner, 2026-11-17);
   *  its far corners may cross the edge as it turns. */
  private focal() {
    return (Math.min(this.w, this.h * 1.35) * 1.35 * this.dist) / (SIDE * 2.3);
  }

  project(x: number, y: number, z: number): Projected {
    const px = x - SIDE / 2;
    const py = y - SIDE / 2;
    const pz = z - SIDE / 2;
    const cy = Math.cos(this.yaw);
    const sy = Math.sin(this.yaw);
    const cp = Math.cos(this.pitch);
    const sp = Math.sin(this.pitch);
    const x1 = cy * px + sy * pz;
    const z1 = -sy * px + cy * pz;
    const y2 = cp * py - sp * z1;
    const z2 = sp * py + cp * z1;
    const depth = Math.max(1, this.dist - z2);
    const scale = this.focal() / depth;
    return { sx: this.w / 2 + x1 * scale, sy: this.h / 2 - y2 * scale, depth, scale };
  }

  /** The world point under canvas pixel (sx, sy), at the depth of the cube's
   *  centre: where the pointer's hawk sits. */
  unproject(sx: number, sy: number): { x: number; y: number; z: number } {
    const scale = this.focal() / this.dist;
    const x1 = (sx - this.w / 2) / scale;
    const y2 = -(sy - this.h / 2) / scale;
    const z2 = 0;
    // Undo the pitch, then the yaw.
    const cp = Math.cos(this.pitch);
    const sp = Math.sin(this.pitch);
    const py = cp * y2 + sp * z2;
    const z1 = -sp * y2 + cp * z2;
    const cyaw = Math.cos(this.yaw);
    const syaw = Math.sin(this.yaw);
    const px = cyaw * x1 - syaw * z1;
    const pz = syaw * x1 + cyaw * z1;
    return { x: px + SIDE / 2, y: py + SIDE / 2, z: pz + SIDE / 2 };
  }

  orbit(dYaw: number, dPitch: number) {
    this.yaw += dYaw;
    this.pitch = Math.max(-1.2, Math.min(1.2, this.pitch + dPitch));
  }

  zoom(factor: number) {
    this.dist = Math.max(SIDE * 1.3, Math.min(SIDE * 4.5, this.dist * factor));
  }
}

/**
 * The Tank camera: a fish tank seen straight on. The box is wide, shallow and
 * fixed; the front glass is the canvas itself (a point on the glass lands on
 * the same pixel whatever the camera does), and the back wall is smaller,
 * as it would be through real glass. A slow sway of the camera's position
 * (`offX`, `offY`, in world units) shifts deep things against near ones, which
 * is what makes it read as depth. No orbit, no cube.
 *
 * World axes: x right, y up, z into the tank (0 is the glass).
 */
export class TankCamera {
  w = 800;
  h = 500;
  /** The box, in world units. */
  sx = 1000;
  sy = 700;
  sz = 500;
  /** The eye's sideways and vertical offset from the tank's centre. */
  offX = 0;
  offY = 0;
  /** The eye's distance in front of the glass, as a multiple of the depth.
   *  Far enough that the back of the tank still fills most of the frame. */
  eye = 2.2;

  private f() {
    return this.sz * this.eye;
  }
  /** Pixels per world unit on the glass. */
  private s0() {
    return this.w / this.sx;
  }

  project(x: number, y: number, z: number): Projected {
    const f = this.f();
    const k = f / (f + z);
    const camX = this.sx / 2 + this.offX;
    const camY = this.sy / 2 + this.offY;
    // The ray from the eye through the point, where it crosses the glass.
    const gx = camX + (x - camX) * k;
    const gy = camY + (y - camY) * k;
    const s0 = this.s0();
    return {
      sx: this.w / 2 + (gx - this.sx / 2) * s0,
      sy: this.h / 2 - (gy - this.sy / 2) * s0,
      depth: f + z,
      scale: s0 * k,
    };
  }

  /** The world point under pixel (px, py) at depth z (the pointer's hawk). */
  unproject(px: number, py: number, z: number): { x: number; y: number; z: number } {
    const f = this.f();
    const s0 = this.s0();
    const gx = (px - this.w / 2) / s0 + this.sx / 2;
    const gy = -(py - this.h / 2) / s0 + this.sy / 2;
    const camX = this.sx / 2 + this.offX;
    const camY = this.sy / 2 + this.offY;
    const k = (f + z) / f;
    return { x: camX + (gx - camX) * k, y: camY + (gy - camY) * k, z };
  }
}

/**
 * The tank's size for a canvas of w × h pixels: always as tall as 700 units
 * and as wide as the canvas is, within a sensible range, and 500 deep. The
 * simulation's distances are in these units, so a flock looks the same size
 * on a phone held upright and on a wide window.
 */
export function tankSize(w: number, h: number): { sx: number; sy: number; sz: number } {
  const sy = 700;
  const aspect = Math.max(0.55, Math.min(2.6, w / Math.max(1, h)));
  return { sx: sy * aspect, sy, sz: 500 };
}
