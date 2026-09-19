import type { Vec2 } from '@ratecad/geometry';

/**
 * Camera maps world coordinates to screen pixels.
 * World Y increases upward (engineering convention).
 * Screen Y increases downward.
 */
export interface Camera {
  /** World X at screen center */
  centerX: number;
  /** World Y at screen center */
  centerY: number;
  /** Pixels per world unit */
  zoom: number;
}

export function createCamera(partial?: Partial<Camera>): Camera {
  return {
    centerX: 0,
    centerY: 0,
    zoom: 40,
    ...partial,
  };
}

export function worldToScreen(
  world: Vec2,
  camera: Camera,
  width: number,
  height: number,
): Vec2 {
  return {
    x: width / 2 + (world.x - camera.centerX) * camera.zoom,
    y: height / 2 - (world.y - camera.centerY) * camera.zoom,
  };
}

export function screenToWorld(
  screen: Vec2,
  camera: Camera,
  width: number,
  height: number,
): Vec2 {
  return {
    x: camera.centerX + (screen.x - width / 2) / camera.zoom,
    y: camera.centerY - (screen.y - height / 2) / camera.zoom,
  };
}

export function zoomAtScreenPoint(
  camera: Camera,
  screenPoint: Vec2,
  factor: number,
  width: number,
  height: number,
  minZoom = 2,
  maxZoom = 400,
): Camera {
  const before = screenToWorld(screenPoint, camera, width, height);
  const zoom = Math.min(maxZoom, Math.max(minZoom, camera.zoom * factor));
  const next: Camera = { ...camera, zoom };
  const after = screenToWorld(screenPoint, next, width, height);
  return {
    zoom,
    centerX: camera.centerX + (before.x - after.x),
    centerY: camera.centerY + (before.y - after.y),
  };
}

export function panCamera(camera: Camera, dxScreen: number, dyScreen: number): Camera {
  return {
    ...camera,
    centerX: camera.centerX - dxScreen / camera.zoom,
    centerY: camera.centerY + dyScreen / camera.zoom,
  };
}

export function screenToleranceToWorld(camera: Camera, pixels = 6): number {
  return pixels / camera.zoom;
}
