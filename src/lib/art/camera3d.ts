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

  /** Focal length in pixels: the cube's diagonal just fits the shorter side. */
  private focal() {
    return (Math.min(this.w, this.h * 1.35) * this.dist) / (SIDE * 2.3);
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
