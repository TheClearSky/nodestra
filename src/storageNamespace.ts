/**
 * The prefix of every key this app stores in the browser (localStorage,
 * sessionStorage, the IndexedDB library). It is the app's FORMER name,
 * `react-blender-nodes-sound`, kept on purpose when the app became Nodestra
 * (2026-09-30): changing it would make every existing browser forget its
 * saved project, library, tutorial progress and settings.
 */
const STORAGE_NAMESPACE = 'react-blender-nodes-sound';

export { STORAGE_NAMESPACE };
