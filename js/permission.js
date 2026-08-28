// Zero-dependency motion permission helper. Deliberately has no import
// of Three.js or anything else, so the diagnostics screen can run and
// report status even if the 3D engine bundle fails to load.

export async function requestMotionPermission() {
  if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
    try {
      const result = await DeviceOrientationEvent.requestPermission();
      return result === 'granted';
    } catch (e) {
      return false;
    }
  }
  return typeof DeviceOrientationEvent !== 'undefined';
}
